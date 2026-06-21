/**
 * Build the audit context string that becomes the user_request for runTask().
 *
 * Each audit type collects the relevant DSL data and rendered files,
 * then formats them into a structured prompt that the dsl-auditor agent
 * can analyze via LLM.
 */

import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import * as yaml from "yaml";
import type { Dsl, ScopeNodeType } from "../schema/index.js";
import type { ResolvedConfig, ResolvedRenderTarget } from "../config/types.js";
import {
  buildPerAgentContext,
  type PerAgentContext,
} from "../renderer/context.js";
import {
  getDslSection,
  filterIds,
  expandOutputPath,
} from "../renderer/renderer.js";
import type { AuditType } from "./types.js";

interface RenderedFileEntry {
  agent_id: string;
  path: string;
  content: string;
}

function buildAllAgentContexts(dsl: Dsl): Map<string, PerAgentContext> {
  const contexts = new Map<string, PerAgentContext>();
  for (const [agentId, agentDef] of Object.entries(dsl.agents)) {
    contexts.set(agentId, buildPerAgentContext(dsl, { ...agentDef, id: agentId }));
  }
  return contexts;
}

async function loadRenderedFiles(
  dsl: Dsl,
  renderTargets: ResolvedRenderTarget[],
): Promise<RenderedFileEntry[]> {
  const entries: RenderedFileEntry[] = [];
  for (const target of renderTargets) {
    if (target.context !== "agent") continue;
    const section = getDslSection(dsl, target.context);
    const ids = filterIds(Object.keys(section), target.include, target.exclude);
    for (const entityId of ids) {
      const entity = section[entityId] as Record<string, unknown> | undefined;
      const outputPath = expandOutputPath(target.output, target.context, entityId, entity);
      try {
        const content = await readFile(outputPath, "utf8");
        entries.push({ agent_id: entityId, path: outputPath, content });
      } catch { /* file may not exist if skip_empty was used */ }
    }
  }
  return entries;
}

function formatAgentSummary(agentId: string, ctx: PerAgentContext): string {
  const a = ctx.agent;
  const lines = [
    `### Agent: ${agentId}`,
    `- Role: ${a.role_name}`,
    `- Purpose: ${a.purpose}`,
    `- Mode: ${a.mode}`,
  ];
  if (ctx.mergedBehavior.responsibilities.length > 0)
    lines.push(`- Responsibilities: ${ctx.mergedBehavior.responsibilities.join("; ")}`);
  if (ctx.mergedBehavior.constraints.length > 0)
    lines.push(`- Constraints: ${ctx.mergedBehavior.constraints.join("; ")}`);
  if (a.can_read_artifacts.length > 0)
    lines.push(`- Can read: ${a.can_read_artifacts.join(", ")}`);
  if (a.can_write_artifacts.length > 0)
    lines.push(`- Can write: ${a.can_write_artifacts.join(", ")}`);
  if (a.can_execute_tools.length > 0)
    lines.push(`- Can execute tools: ${a.can_execute_tools.join(", ")}`);
  if (a.can_invoke_agents.length > 0)
    lines.push(`- Can invoke: ${a.can_invoke_agents.join(", ")}`);
  if (ctx.relatedGuardrails.length > 0)
    lines.push(`- Guardrails: ${ctx.relatedGuardrails.map((g) => g.guardrail_id).join(", ")}`);
  if (ctx.receivableTasks.length > 0)
    lines.push(`- Receivable tasks: ${ctx.receivableTasks.map((t) => t.id).join(", ")}`);
  if (ctx.delegatableTasks.length > 0)
    lines.push(`- Delegatable tasks: ${ctx.delegatableTasks.map((t) => t.id).join(", ")}`);
  return lines.join("\n");
}

function formatDslOverview(dsl: Dsl): string {
  return [
    "## DSL Overview",
    `- System: ${dsl.system.id} (${dsl.system.name})`,
    `- Agents: ${Object.keys(dsl.agents).join(", ")}`,
    `- Tasks: ${Object.keys(dsl.tasks).join(", ")}`,
    `- Workflows: ${Object.keys(dsl.workflow).join(", ")}`,
    `- Artifacts: ${Object.keys(dsl.artifacts).join(", ")}`,
    `- Tools: ${Object.keys(dsl.tools).join(", ")}`,
    `- Guardrails: ${Object.keys(dsl.guardrails).join(", ")}`,
    `- Handoff types: ${Object.keys(dsl.handoff_types).join(", ")}`,
    `- Validations: ${Object.keys(dsl.validations).join(", ")}`,
  ].join("\n");
}

interface XUsageEntry {
  path: string;
  nodeType: ScopeNodeType;
  key: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function collectAllXUsages(dsl: Dsl): XUsageEntry[] {
  const entries: XUsageEntry[] = [];

  function walk(obj: Record<string, unknown>, path: string, nodeType: ScopeNodeType): void {
    for (const key of Object.keys(obj)) {
      if (key.startsWith("x-") && key !== "x-extensions" && key !== "x-extensions-strict") {
        entries.push({ path: path ? `${path}.${key}` : key, nodeType, key });
      }
    }
  }

  walk(dsl as unknown as Record<string, unknown>, "", "root");
  if (isRecord(dsl.system)) walk(dsl.system as unknown as Record<string, unknown>, "system", "system");

  for (const [id, a] of Object.entries(dsl.agents))
    walk(a as unknown as Record<string, unknown>, `agents.${id}`, "agent");
  for (const [id, t] of Object.entries(dsl.tasks))
    walk(t as unknown as Record<string, unknown>, `tasks.${id}`, "task");
  for (const [id, a] of Object.entries(dsl.artifacts))
    walk(a as unknown as Record<string, unknown>, `artifacts.${id}`, "artifact");
  for (const [id, t] of Object.entries(dsl.tools))
    walk(t as unknown as Record<string, unknown>, `tools.${id}`, "tool");
  for (const [id, v] of Object.entries(dsl.validations))
    walk(v as unknown as Record<string, unknown>, `validations.${id}`, "validation");
  for (const [id, h] of Object.entries(dsl.handoff_types))
    walk(h as unknown as Record<string, unknown>, `handoff_types.${id}`, "handoff_type");
  for (const [id, w] of Object.entries(dsl.workflow))
    walk(w as unknown as Record<string, unknown>, `workflow.${id}`, "workflow");
  for (const [id, p] of Object.entries(dsl.policies))
    walk(p as unknown as Record<string, unknown>, `policies.${id}`, "policy");
  for (const [id, g] of Object.entries(dsl.guardrails))
    walk(g as unknown as Record<string, unknown>, `guardrails.${id}`, "guardrail");
  for (const [id, gp] of Object.entries(dsl.guardrail_policies))
    walk(gp as unknown as Record<string, unknown>, `guardrail_policies.${id}`, "guardrail_policy");

  return entries;
}

function extractTemplateXReferences(config: ResolvedConfig): string[] {
  const refs: string[] = [];
  for (const target of config.renders) {
    try {
      const content = readFileSync(target.template, "utf8");
      const matches = content.matchAll(/\{\{[^}]*?(x-[\w-]+)[^}]*?\}\}/g);
      for (const m of matches) refs.push(m[1]);
    } catch { /* template may not exist */ }
  }
  return [...new Set(refs)];
}

function buildExtensionsContext(dsl: Dsl, config: ResolvedConfig): string {
  const parts: string[] = [];

  parts.push("## Extension Declarations");
  const declaredKeys = Object.keys(dsl.extensions);
  if (declaredKeys.length === 0) {
    parts.push("(No extensions declared in `extensions` section)");
  } else {
    parts.push("```yaml\n" + yaml.stringify({ extensions: dsl.extensions }) + "```");
  }

  parts.push("## x-* Usage Map");
  const usages = collectAllXUsages(dsl);
  if (usages.length === 0) {
    parts.push("(No x-* properties found on any entity)");
  } else {
    const byKey = new Map<string, XUsageEntry[]>();
    for (const u of usages) {
      let list = byKey.get(u.key);
      if (!list) { list = []; byKey.set(u.key, list); }
      list.push(u);
    }
    const lines: string[] = ["| Extension | Node Type | Path |", "|-----------|-----------|------|"];
    for (const [key, entries] of byKey) {
      for (const e of entries) {
        lines.push(`| ${key} | ${e.nodeType} | ${e.path} |`);
      }
    }
    parts.push(lines.join("\n"));
  }

  parts.push("## Template x-* References");
  const templateRefs = extractTemplateXReferences(config);
  if (templateRefs.length === 0) {
    parts.push("(No x-* references found in render templates, or no templates configured)");
  } else {
    parts.push(templateRefs.map((r) => `- ${r}`).join("\n"));
  }

  parts.push("## Runtime Codegen Fixed Fields");
  parts.push(
    "The agent-contracts-runtime codegen templates emit only these fixed fields " +
    "(x-* properties are not included in generated TypeScript contracts):\n" +
    "- **AgentContract**: id, role_name, purpose, mode, dispatch_only, can_read_artifacts, " +
    "can_write_artifacts, can_execute_tools, can_invoke_agents, can_return_handoffs, " +
    "responsibilities, constraints, rules, escalation_criteria\n" +
    "- **TaskContract**: id, description, target_agent, allowed_from_agents, workflow, " +
    "invocation_handoff, result_handoff, input_artifacts, responsibilities, " +
    "completion_criteria, optional\n" +
    "- **WorkflowContract**: id, description, trigger, entry_conditions, steps",
  );

  const declaredSet = new Set(declaredKeys);
  const usedKeys = new Set(usages.map((u) => u.key));
  const templateRefSet = new Set(templateRefs);

  parts.push("## Gap Summary");
  const gaps: string[] = [];
  for (const key of declaredKeys) {
    if (!usedKeys.has(key)) gaps.push(`- **${key}**: declared but never populated on any entity`);
  }
  for (const key of usedKeys) {
    if (declaredKeys.length > 0 && !declaredSet.has(key))
      gaps.push(`- **${key}**: used on entities but not declared in extensions`);
    if (!templateRefSet.has(key))
      gaps.push(`- **${key}**: populated on entities but not referenced in any render template`);
  }
  if (gaps.length === 0) {
    parts.push("(No obvious gaps detected by static analysis)");
  } else {
    parts.push(gaps.join("\n"));
  }

  return parts.join("\n\n");
}

export async function buildAuditContext(
  auditType: AuditType,
  dsl: Dsl,
  config: ResolvedConfig,
): Promise<string> {
  const sections: string[] = [];
  sections.push(formatDslOverview(dsl));

  if (auditType === "render" || auditType === "prompt") {
    const agentContexts = buildAllAgentContexts(dsl);
    const renderedFiles = await loadRenderedFiles(dsl, config.renders);

    sections.push("## Agent DSL Definitions");
    for (const [agentId, ctx] of agentContexts) {
      sections.push(formatAgentSummary(agentId, ctx));
    }

    sections.push("## Generated Prompt Files");
    for (const entry of renderedFiles) {
      sections.push(`### ${entry.agent_id} (${entry.path})\n\n${entry.content}`);
    }
    if (renderedFiles.length === 0) {
      sections.push("(No rendered agent prompt files found. Run `agent-contracts render` first.)");
    }
  }

  if (auditType === "extensions") {
    sections.push(buildExtensionsContext(dsl, config));
  }

  if (auditType === "dsl") {
    sections.push("## Agent Definitions");
    for (const [agentId, agentDef] of Object.entries(dsl.agents)) {
      sections.push(`### ${agentId}\n\`\`\`yaml\n${yaml.stringify({ [agentId]: agentDef })}\`\`\``);
    }

    sections.push("## Tasks");
    for (const [taskId, task] of Object.entries(dsl.tasks)) {
      sections.push(`### ${taskId}\n\`\`\`yaml\n${yaml.stringify({ [taskId]: task })}\`\`\``);
    }

    sections.push("## Workflows");
    for (const [wfId, wf] of Object.entries(dsl.workflow)) {
      sections.push(`### ${wfId}\n\`\`\`yaml\n${yaml.stringify({ [wfId]: wf })}\`\`\``);
    }

    sections.push("## Guardrails");
    for (const [gId, g] of Object.entries(dsl.guardrails)) {
      sections.push(`### ${gId}\n\`\`\`yaml\n${yaml.stringify({ [gId]: g })}\`\`\``);
    }

    sections.push("## Handoff Types");
    for (const [htId, ht] of Object.entries(dsl.handoff_types)) {
      sections.push(`### ${htId}\n\`\`\`yaml\n${yaml.stringify({ [htId]: ht })}\`\`\``);
    }
  }

  return sections.join("\n\n");
}
