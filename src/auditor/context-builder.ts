/**
 * Build the audit context string that becomes the user_request for runTask().
 *
 * Each audit type collects the relevant DSL data and rendered files,
 * then formats them into a structured prompt that the dsl-auditor agent
 * can analyze via LLM.
 */

import { readFile } from "node:fs/promises";
import * as yaml from "yaml";
import type { Dsl } from "../schema/index.js";
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
      const outputPath = expandOutputPath(target.output, target.context, entityId);
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
