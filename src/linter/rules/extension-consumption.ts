import type { Dsl, ScopeNodeType } from "../../schema/index.js";
import type { LintRule, LintDiagnostic } from "../types.js";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

interface XUsage {
  path: string;
  nodeType: ScopeNodeType;
}

/**
 * Walk the DSL tree and collect every `x-*` key found on entities,
 * grouped by extension key name.
 */
function collectXUsages(dsl: Dsl): Map<string, XUsage[]> {
  const usages = new Map<string, XUsage[]>();

  function record(key: string, path: string, nodeType: ScopeNodeType): void {
    let list = usages.get(key);
    if (!list) {
      list = [];
      usages.set(key, list);
    }
    list.push({ path, nodeType });
  }

  function walkObj(
    obj: Record<string, unknown>,
    path: string,
    nodeType: ScopeNodeType,
  ): void {
    for (const key of Object.keys(obj)) {
      if (key.startsWith("x-") && key !== "x-extensions" && key !== "x-extensions-strict") {
        record(key, path ? `${path}.${key}` : key, nodeType);
      }
    }
  }

  walkObj(dsl as unknown as Record<string, unknown>, "", "root");

  if (isRecord(dsl.system)) {
    walkObj(dsl.system as unknown as Record<string, unknown>, "system", "system");
  }

  for (const [id, agent] of Object.entries(dsl.agents)) {
    const agentObj = agent as unknown as Record<string, unknown>;
    walkObj(agentObj, `agents.${id}`, "agent");
    if (Array.isArray(agentObj["rules"])) {
      for (let i = 0; i < agentObj["rules"].length; i++) {
        const r = agentObj["rules"][i];
        if (isRecord(r)) walkObj(r, `agents.${id}.rules[${i}]`, "rule");
      }
    }
    if (Array.isArray(agentObj["escalation_criteria"])) {
      for (let i = 0; i < agentObj["escalation_criteria"].length; i++) {
        const e = agentObj["escalation_criteria"][i];
        if (isRecord(e)) walkObj(e, `agents.${id}.escalation_criteria[${i}]`, "escalation_criterion");
      }
    }
    if (Array.isArray(agentObj["prerequisites"])) {
      for (let i = 0; i < agentObj["prerequisites"].length; i++) {
        const p = agentObj["prerequisites"][i];
        if (isRecord(p)) walkObj(p, `agents.${id}.prerequisites[${i}]`, "prerequisite");
      }
    }
  }

  for (const [id, task] of Object.entries(dsl.tasks)) {
    const taskObj = task as unknown as Record<string, unknown>;
    walkObj(taskObj, `tasks.${id}`, "task");
    if (Array.isArray(taskObj["execution_steps"])) {
      for (let i = 0; i < taskObj["execution_steps"].length; i++) {
        const s = taskObj["execution_steps"][i];
        if (isRecord(s)) walkObj(s, `tasks.${id}.execution_steps[${i}]`, "execution_step");
      }
    }
  }

  for (const [id, art] of Object.entries(dsl.artifacts)) {
    walkObj(art as unknown as Record<string, unknown>, `artifacts.${id}`, "artifact");
  }

  for (const [id, tool] of Object.entries(dsl.tools)) {
    const toolObj = tool as unknown as Record<string, unknown>;
    walkObj(toolObj, `tools.${id}`, "tool");
    if (Array.isArray(toolObj["commands"])) {
      for (let i = 0; i < toolObj["commands"].length; i++) {
        const c = toolObj["commands"][i];
        if (isRecord(c)) walkObj(c, `tools.${id}.commands[${i}]`, "tool_command");
      }
    }
  }

  for (const [id, val] of Object.entries(dsl.validations)) {
    walkObj(val as unknown as Record<string, unknown>, `validations.${id}`, "validation");
  }

  for (const [id, ht] of Object.entries(dsl.handoff_types)) {
    walkObj(ht as unknown as Record<string, unknown>, `handoff_types.${id}`, "handoff_type");
  }

  for (const [id, wf] of Object.entries(dsl.workflow)) {
    const wfObj = wf as unknown as Record<string, unknown>;
    walkObj(wfObj, `workflow.${id}`, "workflow");
    if (Array.isArray(wfObj["steps"])) {
      for (let i = 0; i < wfObj["steps"].length; i++) {
        const s = wfObj["steps"][i];
        if (isRecord(s)) walkObj(s, `workflow.${id}.steps[${i}]`, "workflow_step");
      }
    }
  }

  for (const [id, pol] of Object.entries(dsl.policies)) {
    walkObj(pol as unknown as Record<string, unknown>, `policies.${id}`, "policy");
  }

  for (const [id, gr] of Object.entries(dsl.guardrails)) {
    walkObj(gr as unknown as Record<string, unknown>, `guardrails.${id}`, "guardrail");
  }

  for (const [id, gp] of Object.entries(dsl.guardrail_policies)) {
    walkObj(gp as unknown as Record<string, unknown>, `guardrail_policies.${id}`, "guardrail_policy");
  }

  return usages;
}

export const extensionDeclaredButUnusedRule: LintRule = {
  id: "extension-declared-unused",
  description:
    "Declared extension in `extensions` is never used on any entity",

  run(dsl: Dsl): LintDiagnostic[] {
    const diagnostics: LintDiagnostic[] = [];
    const declaredKeys = Object.keys(dsl.extensions);
    if (declaredKeys.length === 0) return diagnostics;

    const usages = collectXUsages(dsl);

    for (const key of declaredKeys) {
      if (!usages.has(key)) {
        diagnostics.push({
          ruleId: "extension-declared-unused",
          severity: "warning",
          path: `extensions.${key}`,
          message: `Extension "${key}" is declared but never used on any entity`,
        });
      }
    }

    return diagnostics;
  },
};

export const extensionScopeMismatchRule: LintRule = {
  id: "extension-scope-mismatch",
  description:
    "Extension used on a node type outside its declared scope",

  run(dsl: Dsl): LintDiagnostic[] {
    const diagnostics: LintDiagnostic[] = [];
    const extensions = dsl.extensions;
    if (Object.keys(extensions).length === 0) return diagnostics;

    const usages = collectXUsages(dsl);

    for (const [key, decl] of Object.entries(extensions)) {
      const scope = decl.scope;
      if (!scope || scope.length === 0) continue;
      const scopeSet = new Set(scope);

      const keyUsages = usages.get(key);
      if (!keyUsages) continue;

      for (const usage of keyUsages) {
        if (!scopeSet.has(usage.nodeType)) {
          diagnostics.push({
            ruleId: "extension-scope-mismatch",
            severity: "warning",
            path: usage.path,
            message: `Extension "${key}" is used on ${usage.nodeType} but declared scope is [${scope.join(", ")}]`,
          });
        }
      }
    }

    return diagnostics;
  },
};

export const extensionUndeclaredUsageRule: LintRule = {
  id: "extension-undeclared-usage",
  description:
    "Entity uses x-* property that is not declared in extensions (when extensions section exists)",

  run(dsl: Dsl): LintDiagnostic[] {
    const diagnostics: LintDiagnostic[] = [];
    const extensions = dsl.extensions;
    if (Object.keys(extensions).length === 0) return diagnostics;

    const declaredKeys = new Set(Object.keys(extensions));
    const usages = collectXUsages(dsl);

    for (const [key, keyUsages] of usages) {
      if (declaredKeys.has(key)) continue;
      for (const usage of keyUsages) {
        diagnostics.push({
          ruleId: "extension-undeclared-usage",
          severity: "info",
          path: usage.path,
          message: `Extension "${key}" is used but not declared in extensions — consider adding a declaration`,
        });
      }
    }

    return diagnostics;
  },
};
