import type { Dsl } from "../schema/index.js";
import { buildWorkflowContext } from "./context.js";

interface PhaseOps {
  agentOps: Map<string, Set<string>>;
  artifactOps: Map<string, Set<string>>;
  toolOps: Map<string, Set<string>>;
}

function collectPhaseOps(dsl: Dsl, wfId: string): PhaseOps {
  const ctx = buildWorkflowContext(dsl, wfId);
  const wf = dsl.workflow[wfId];
  const agentOps = new Map<string, Set<string>>();
  const artifactOps = new Map<string, Set<string>>();
  const toolOps = new Map<string, Set<string>>();

  function addOp(map: Map<string, Set<string>>, id: string, op: string): void {
    if (!map.has(id)) map.set(id, new Set());
    map.get(id)!.add(op);
  }

  const taskMap = new Map(ctx.relatedTasks.map((t) => [t.id, t]));

  function collectTaskOps(task: { target_agent: string; execution_steps?: Array<{ reads_artifact?: string; produces_artifact?: string; uses_tool?: string; action: string }> }): void {
    addOp(agentOps, task.target_agent, "execute");
    for (const es of task.execution_steps ?? []) {
      if (es.reads_artifact) addOp(artifactOps, es.reads_artifact, "R");
      if (es.produces_artifact) addOp(artifactOps, es.produces_artifact, "W");
      if (es.uses_tool) {
        const tool = dsl.tools[es.uses_tool];
        if (tool) {
          const cats = tool.commands
            .map((c) => c.category)
            .filter((v, i, a) => a.indexOf(v) === i);
          for (const cat of cats) addOp(toolOps, es.uses_tool, cat);
          if (cats.length === 0) addOp(toolOps, es.uses_tool, "✓");
        } else {
          addOp(toolOps, es.uses_tool, "✓");
        }
      }
    }
  }

  for (const step of wf.steps) {
    if (step.type === "delegate") {
      addOp(agentOps, step.from_agent, "delegate");
      const task = taskMap.get(step.task);
      if (task) collectTaskOps(task);
    } else if (step.type === "gate") {
      // gate is a self-referencing review step; no additional ops to collect
    } else if (step.type === "handoff") {
      if (step.from_agent) addOp(agentOps, step.from_agent, "delegate");
      if (step.task) {
        const task = taskMap.get(step.task);
        if (task) collectTaskOps(task);
      }
    } else if (step.type === "validation") {
      const val = dsl.validations[step.validation];
      if (val) {
        if (val.executor_type === "agent" && val.executor) {
          addOp(agentOps, val.executor, "validate");
        } else if (val.executor) {
          addOp(toolOps, val.executor, "verification");
        }
        addOp(artifactOps, val.target_artifact, "V");
      }
    }
  }

  return { agentOps, artifactOps, toolOps };
}

function formatOps(ops: Set<string> | undefined): string {
  if (!ops || ops.size === 0) return "—";
  return [...ops].join(", ");
}

function buildTable(
  header: string[],
  rows: string[][],
): string {
  const lines: string[] = [];
  lines.push("| " + header.join(" | ") + " |");
  lines.push("|" + header.map(() => "---").join("|") + "|");
  for (const row of rows) {
    lines.push("| " + row.join(" | ") + " |");
  }
  return lines.join("\n");
}

export function generateOverviewFlowchart(dsl: Dsl): string {
  const workflowOrder =
    dsl.system.default_workflow_order ?? Object.keys(dsl.workflow);
  const phases = workflowOrder.filter((id) => dsl.workflow[id]);

  const phaseData = new Map<string, PhaseOps>();
  for (const wfId of phases) {
    phaseData.set(wfId, collectPhaseOps(dsl, wfId));
  }

  const allAgentIds = new Set<string>();
  const allArtifactIds = new Set<string>();
  const allToolIds = new Set<string>();
  for (const ops of phaseData.values()) {
    for (const id of ops.agentOps.keys()) allAgentIds.add(id);
    for (const id of ops.artifactOps.keys()) allArtifactIds.add(id);
    for (const id of ops.toolOps.keys()) allToolIds.add(id);
  }

  const sections: string[] = [];

  if (allAgentIds.size > 0) {
    const header = ["Agent", ...phases];
    const rows: string[][] = [];
    for (const agentId of allAgentIds) {
      const agent = dsl.agents[agentId];
      const label = agent ? agent.role_name : agentId;
      const row = [label];
      for (const wfId of phases) {
        row.push(formatOps(phaseData.get(wfId)!.agentOps.get(agentId)));
      }
      rows.push(row);
    }
    sections.push("#### Agent × Phase\n\n" + buildTable(header, rows));
  }

  if (allArtifactIds.size > 0) {
    const header = ["Artifact", ...phases];
    const rows: string[][] = [];
    for (const artId of allArtifactIds) {
      const row = [artId];
      for (const wfId of phases) {
        row.push(formatOps(phaseData.get(wfId)!.artifactOps.get(artId)));
      }
      rows.push(row);
    }
    sections.push("#### Artifact × Phase\n\n" + buildTable(header, rows));
  }

  if (allToolIds.size > 0) {
    const header = ["Tool", ...phases];
    const rows: string[][] = [];
    for (const toolId of allToolIds) {
      const row = [toolId];
      for (const wfId of phases) {
        row.push(formatOps(phaseData.get(wfId)!.toolOps.get(toolId)));
      }
      rows.push(row);
    }
    sections.push("#### Tool × Phase\n\n" + buildTable(header, rows));
  }

  return sections.join("\n\n");
}
