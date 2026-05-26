import type { Action, ConditionalAction, Dsl } from "../../schema/index.js";
import type { LintRule, LintDiagnostic } from "../types.js";

function isConditionalAction(action: Action): action is ConditionalAction {
  return typeof action === "object" && action !== null && "default" in action;
}

function collectReferencedWhenStates(dsl: Dsl): Set<string> {
  const referenced = new Set<string>();
  for (const policy of Object.values(dsl.guardrail_policies)) {
    for (const rule of policy.rules) {
      if (isConditionalAction(rule.action)) {
        for (const state of Object.keys(rule.action.when)) {
          referenced.add(state);
        }
      }
    }
  }
  return referenced;
}

export const guardrailPolicyActionStateUndefinedRule: LintRule = {
  id: "guardrail-policy-action-state-undefined",
  description:
    "Policy rule action.when keys must reference states declared in system.states",

  run(dsl: Dsl): LintDiagnostic[] {
    const diagnostics: LintDiagnostic[] = [];
    const systemStates = new Set(dsl.system.states ?? []);

    for (const [policyId, policy] of Object.entries(dsl.guardrail_policies)) {
      for (let ruleIndex = 0; ruleIndex < policy.rules.length; ruleIndex++) {
        const rule = policy.rules[ruleIndex];
        if (!isConditionalAction(rule.action)) continue;

        for (const state of Object.keys(rule.action.when)) {
          if (!systemStates.has(state)) {
            diagnostics.push({
              ruleId: "guardrail-policy-action-state-undefined",
              severity: "error",
              path: `guardrail_policies.${policyId}.rules[${ruleIndex}].action.when.${state}`,
              message: `Policy rule references state "${state}" in action.when, but it is not declared in system.states`,
            });
          }
        }
      }
    }

    return diagnostics;
  },
};

export const systemStatesUnusedRule: LintRule = {
  id: "system-states-unused",
  description:
    "Each state in system.states should be referenced by at least one policy rule action.when",

  run(dsl: Dsl): LintDiagnostic[] {
    const diagnostics: LintDiagnostic[] = [];
    const states = dsl.system.states ?? [];
    if (states.length === 0) return diagnostics;

    const referenced = collectReferencedWhenStates(dsl);

    for (const state of states) {
      if (!referenced.has(state)) {
        diagnostics.push({
          ruleId: "system-states-unused",
          severity: "info",
          path: `system.states`,
          message: `State "${state}" is declared in system.states but not referenced by any policy rule action.when`,
        });
      }
    }

    return diagnostics;
  },
};
