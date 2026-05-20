import type {
  Dsl,
  Agent,
  Task,
  Workflow,
  WorkflowStep,
  ExecutionStep,
  ExternalParticipant,
} from "../schema/index.js";

interface ParticipantInfo {
  id: string;
  alias: string;
  label: string;
  group: "external" | "agents" | "audit" | "toolchain" | "artifacts";
}

function hashToColor(s: string, saturation: number, lightness: number): string {
  let hash = 0;
  for (const ch of s) hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0;
  const h = ((hash % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lightness - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return `rgb(${Math.round((r + m) * 255)},${Math.round((g + m) * 255)},${Math.round((b + m) * 255)})`;
}

function sanitizeAlias(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, "_");
}

function agentAlias(id: string, agent: Agent): string {
  const words = agent.role_name.split(/\s+/);
  if (words.length === 1) return sanitizeAlias(words[0].slice(0, 4));
  return sanitizeAlias(words.map((w) => w[0]).join(""));
}

interface CollectedIds {
  agents: Set<string>;
  auditAgents: Set<string>;
  tools: Set<string>;
  artifacts: Set<string>;
}

function collectReferencedIds(
  workflow: Workflow & { id: string },
  dsl: Dsl,
  relatedTasks: Array<Task & { id: string }>,
): CollectedIds {
  const agents = new Set<string>();
  const auditAgents = new Set<string>();
  const tools = new Set<string>();
  const artifacts = new Set<string>();

  const taskMap = new Map<string, Task & { id: string }>();
  for (const t of relatedTasks) taskMap.set(t.id, t);

  function collectTaskIds(task: Task & { id: string }): void {
    addAgent(task.target_agent);
    for (const es of task.execution_steps ?? []) {
      collectExecutionStepIds(es, tools, artifacts);
    }
  }

  function collectRetryIds(retry: { fix_task: string; revalidate_task?: string }): void {
    const fixTask = taskMap.get(retry.fix_task);
    if (fixTask) collectTaskIds(fixTask);
    if (retry.revalidate_task) {
      const revalTask = taskMap.get(retry.revalidate_task);
      if (revalTask) addAgent(revalTask.target_agent);
    }
  }

  for (const step of workflow.steps) {
    if (step.type === "delegate") {
      addAgent(step.from_agent);
      const task = taskMap.get(step.task);
      if (task) collectTaskIds(task);
      if (step.retry) collectRetryIds(step.retry);
    } else if (step.type === "gate") {
      // gate is a self-referencing step on the last from_agent
    } else if (step.type === "handoff") {
      if (step.from_agent) addAgent(step.from_agent);
      if (step.task) {
        const task = taskMap.get(step.task);
        if (task) collectTaskIds(task);
      }
      if (step.retry) collectRetryIds(step.retry);
    } else if (step.type === "validation") {
      const val = dsl.validations[step.validation];
      if (val) {
        if (val.executor && val.executor_type === "agent") addAgent(val.executor);
        else if (val.executor) tools.add(val.executor);
        artifacts.add(val.target_artifact);
      }
    }
  }

  function addAgent(agentId: string): void {
    const agent = dsl.agents[agentId];
    if (agent?.mode === "read-only") {
      auditAgents.add(agentId);
    } else {
      agents.add(agentId);
    }
  }

  return { agents, auditAgents, tools, artifacts };
}

function collectExecutionStepIds(
  es: ExecutionStep,
  tools: Set<string>,
  artifacts: Set<string>,
): void {
  if (es.uses_tool) tools.add(es.uses_tool);
  if (es.produces_artifact) artifacts.add(es.produces_artifact);
  if (es.reads_artifact) artifacts.add(es.reads_artifact);
}

function buildParticipants(
  ids: CollectedIds,
  externals: ExternalParticipant[],
  dsl: Dsl,
): ParticipantInfo[] {
  const participants: ParticipantInfo[] = [];
  const usedAliases = new Set<string>();

  function uniqueAlias(preferred: string): string {
    let alias = preferred;
    let i = 2;
    while (usedAliases.has(alias)) {
      alias = `${preferred}${i}`;
      i++;
    }
    usedAliases.add(alias);
    return alias;
  }

  for (const ep of externals) {
    const alias = uniqueAlias(sanitizeAlias(ep.id));
    participants.push({ id: ep.id, alias, label: ep.label, group: "external" });
  }

  for (const id of ids.agents) {
    const agent = dsl.agents[id];
    if (!agent) continue;
    const alias = uniqueAlias(agentAlias(id, agent));
    participants.push({ id, alias, label: agent.role_name, group: "agents" });
  }

  for (const id of ids.auditAgents) {
    const agent = dsl.agents[id];
    if (!agent) continue;
    const alias = uniqueAlias(agentAlias(id, agent));
    participants.push({ id, alias, label: agent.role_name, group: "audit" });
  }

  for (const id of ids.tools) {
    const tool = dsl.tools[id];
    if (!tool) continue;
    const alias = uniqueAlias(sanitizeAlias(id));
    participants.push({ id, alias, label: id, group: "toolchain" });
  }

  for (const id of ids.artifacts) {
    const art = dsl.artifacts[id];
    if (!art) continue;
    const alias = uniqueAlias(sanitizeAlias(id));
    participants.push({ id, alias, label: id, group: "artifacts" });
  }

  return participants;
}

function participantAlias(participants: ParticipantInfo[], id: string): string {
  const p = participants.find((pp) => pp.id === id);
  return p ? p.alias : sanitizeAlias(id);
}

function emitParticipants(
  participants: ParticipantInfo[],
  externals: ExternalParticipant[],
  lines: string[],
  indent: string,
): void {
  const groups: Record<string, ParticipantInfo[]> = {
    external: [],
    agents: [],
    audit: [],
    toolchain: [],
    artifacts: [],
  };
  for (const p of participants) groups[p.group].push(p);

  const externalMap = new Map<string, ExternalParticipant>();
  for (const ep of externals) externalMap.set(ep.id, ep);

  if (groups.external.length > 0) {
    lines.push(`${indent}box rgb(255,245,230) External`);
    for (const p of groups.external) {
      const ep = externalMap.get(p.id);
      const keyword = ep?.kind === "actor" ? "actor" : "participant";
      if (p.alias === p.label) {
        lines.push(`${indent}${keyword} ${p.alias}`);
      } else {
        lines.push(`${indent}${keyword} ${p.alias} as ${p.label}`);
      }
    }
    lines.push(`${indent}end`);
  }

  const groupConfig: Array<{ key: string; label: string; color: string }> = [
    { key: "agents", label: "Agents", color: "rgb(200,220,255)" },
    { key: "audit", label: "Audit", color: "rgb(255,220,220)" },
    { key: "toolchain", label: "Toolchain", color: "rgb(220,255,220)" },
    { key: "artifacts", label: "Artifacts", color: "rgb(255,230,210)" },
  ];

  for (const { key, label, color } of groupConfig) {
    const members = groups[key];
    if (members.length === 0) continue;
    lines.push(`${indent}box ${color} ${label}`);
    for (const p of members) {
      if (p.alias === p.label) {
        lines.push(`${indent}participant ${p.alias}`);
      } else {
        lines.push(`${indent}participant ${p.alias} as ${p.label}`);
      }
    }
    lines.push(`${indent}end`);
  }
}

function emitHandoffStep(
  step: Extract<WorkflowStep, { type: "handoff" }>,
  participants: ParticipantInfo[],
  dsl: Dsl,
  relatedTasks: Array<Task & { id: string }>,
  lines: string[],
  indent: string,
): void {
  const taskMap = new Map<string, Task & { id: string }>();
  for (const t of relatedTasks) taskMap.set(t.id, t);

  if (!step.task) {
    if (step.from_agent) {
      const fromAlias = participantAlias(participants, step.from_agent);
      lines.push(`${indent}${fromAlias}->>${fromAlias}: ${step.handoff_kind}`);
    }
    return;
  }

  const task = taskMap.get(step.task);
  if (!task) return;

  const fromAlias = step.from_agent
    ? participantAlias(participants, step.from_agent)
    : null;
  const targetAlias = participantAlias(participants, task.target_agent);

  if (fromAlias) {
    lines.push(`${indent}${fromAlias}->>${targetAlias}: delegate ${step.task}`);
  }

  for (const es of task.execution_steps ?? []) {
    emitExecutionStep(es, targetAlias, participants, lines, indent);
  }

  if (fromAlias) {
    lines.push(`${indent}${targetAlias}-->>${fromAlias}: ${task.result_handoff}`);
  }
}

function emitExecutionStep(
  es: ExecutionStep,
  agentAlias: string,
  participants: ParticipantInfo[],
  lines: string[],
  indent: string,
): void {
  if (es.reads_artifact) {
    const artAlias = participantAlias(participants, es.reads_artifact);
    lines.push(`${indent}${agentAlias}->>${artAlias}: [R] ${es.action}`);
  }
  if (es.produces_artifact) {
    const artAlias = participantAlias(participants, es.produces_artifact);
    lines.push(`${indent}${agentAlias}->>${artAlias}: [W] ${es.action}`);
  }
  if (es.uses_tool) {
    const toolAlias = participantAlias(participants, es.uses_tool);
    lines.push(`${indent}${agentAlias}->>${toolAlias}: ${es.action}`);
  }
  if (!es.reads_artifact && !es.produces_artifact && !es.uses_tool) {
    lines.push(`${indent}${agentAlias}->>${agentAlias}: ${es.action}`);
  }
}

function emitValidationStep(
  step: Extract<WorkflowStep, { type: "validation" }>,
  participants: ParticipantInfo[],
  dsl: Dsl,
  lastFromAgent: string | undefined,
  lines: string[],
  indent: string,
): void {
  const val = dsl.validations[step.validation];
  if (!val || !val.executor) return;

  const executorAlias = participantAlias(participants, val.executor);
  const artifactAlias = participantAlias(participants, val.target_artifact);
  const fromAlias = lastFromAgent
    ? participantAlias(participants, lastFromAgent)
    : null;

  if (fromAlias && fromAlias !== executorAlias) {
    lines.push(`${indent}${fromAlias}->>${executorAlias}: ${step.validation}`);
  }
  lines.push(`${indent}${executorAlias}->>${artifactAlias}: [R] ${val.target_artifact}`);
  if (fromAlias && fromAlias !== executorAlias) {
    lines.push(`${indent}${executorAlias}-->>${fromAlias}: results`);
  }
}

function emitDecisionStep(
  step: Extract<WorkflowStep, { type: "decision" }>,
  participants: ParticipantInfo[],
  lastFromAgent: string | undefined,
  lines: string[],
  indent: string,
): void {
  const branches = Object.entries(step.branches);
  if (branches.length === 0) return;

  const agentAl = lastFromAgent
    ? participantAlias(participants, lastFromAgent)
    : null;

  for (let i = 0; i < branches.length; i++) {
    const [key, values] = branches[i];
    if (i === 0) {
      lines.push(`${indent}alt ${key}`);
    } else {
      lines.push(`${indent}else ${key}`);
    }
    if (agentAl) {
      lines.push(`${indent}    Note over ${agentAl}: ${values.join(", ")}`);
    }
  }
  lines.push(`${indent}end`);
}

function emitDelegateStep(
  step: Extract<WorkflowStep, { type: "delegate" }>,
  participants: ParticipantInfo[],
  dsl: Dsl,
  relatedTasks: Array<Task & { id: string }>,
  lines: string[],
  indent: string,
): void {
  const taskMap = new Map<string, Task & { id: string }>();
  for (const t of relatedTasks) taskMap.set(t.id, t);

  const task = taskMap.get(step.task);
  if (!task) return;

  const fromAlias = participantAlias(participants, step.from_agent);
  const targetAlias = participantAlias(participants, task.target_agent);

  lines.push(`${indent}${fromAlias}->>${targetAlias}: delegate ${step.task}`);

  for (const es of task.execution_steps ?? []) {
    emitExecutionStep(es, targetAlias, participants, lines, indent);
  }

  lines.push(`${indent}${targetAlias}-->>${fromAlias}: ${task.result_handoff}`);
}

function emitGateStep(
  step: Extract<WorkflowStep, { type: "gate" }>,
  participants: ParticipantInfo[],
  lastFromAgent: string | undefined,
  lines: string[],
  indent: string,
): void {
  if (lastFromAgent) {
    const agentAl = participantAlias(participants, lastFromAgent);
    lines.push(`${indent}${agentAl}->>${agentAl}: ${step.gate_kind}`);
  }
}

function emitRetryBlock(
  fromAgent: string | undefined,
  retry: { condition: string; fix_task: string; revalidate_task?: string },
  participants: ParticipantInfo[],
  relatedTasks: Array<Task & { id: string }>,
  lines: string[],
  indent: string,
): void {
  const taskMap = new Map<string, Task & { id: string }>();
  for (const t of relatedTasks) taskMap.set(t.id, t);

  lines.push(`${indent}opt ${retry.condition}`);
  const innerIndent = indent + "    ";

  const fixTask = taskMap.get(retry.fix_task);
  if (fixTask) {
    const fromAlias = fromAgent
      ? participantAlias(participants, fromAgent)
      : null;
    const targetAlias = participantAlias(participants, fixTask.target_agent);
    if (fromAlias) {
      lines.push(`${innerIndent}${fromAlias}->>${targetAlias}: fix ${retry.fix_task}`);
    }
    for (const es of fixTask.execution_steps ?? []) {
      emitExecutionStep(es, targetAlias, participants, lines, innerIndent);
    }
    if (fromAlias) {
      lines.push(`${innerIndent}${targetAlias}-->>${fromAlias}: ${fixTask.result_handoff}`);
    }
  }

  if (retry.revalidate_task) {
    const revalTask = taskMap.get(retry.revalidate_task);
    if (revalTask) {
      const fromAlias = fromAgent
        ? participantAlias(participants, fromAgent)
        : null;
      const revalAlias = participantAlias(participants, revalTask.target_agent);
      if (fromAlias) {
        lines.push(`${innerIndent}${fromAlias}->>${revalAlias}: revalidate ${retry.revalidate_task}`);
        lines.push(`${innerIndent}${revalAlias}-->>${fromAlias}: ${revalTask.result_handoff}`);
      }
    }
  }

  lines.push(`${indent}end`);
}

interface GroupedSteps {
  group: string | null;
  steps: Array<{ step: WorkflowStep; index: number }>;
}

function groupSteps(steps: WorkflowStep[]): GroupedSteps[] {
  const result: GroupedSteps[] = [];
  let currentGroup: GroupedSteps | null = null;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const group = ("group" in step ? step.group : undefined) as string | undefined;

    if (group) {
      if (currentGroup && currentGroup.group === group) {
        currentGroup.steps.push({ step, index: i });
      } else {
        if (currentGroup) result.push(currentGroup);
        currentGroup = { group, steps: [{ step, index: i }] };
      }
    } else {
      if (currentGroup) {
        result.push(currentGroup);
        currentGroup = null;
      }
      result.push({ group: null, steps: [{ step, index: i }] });
    }
  }
  if (currentGroup) result.push(currentGroup);

  return result;
}

export function generateSequenceDiagram(
  workflow: Workflow & { id: string },
  relatedTasks: Array<(Task & Record<string, unknown>) & { id: string }>,
  dsl: Dsl,
): string {
  const ids = collectReferencedIds(workflow, dsl, relatedTasks);
  const externals = workflow.external_participants ?? [];
  const participants = buildParticipants(ids, externals, dsl);
  const lines: string[] = [];
  const indent = "    ";

  lines.push("sequenceDiagram");
  emitParticipants(participants, externals, lines, indent);

  lines.push("");
  lines.push(`${indent}rect ${hashToColor(workflow.id, 0.15, 0.95)}`);

  const firstP = participants[0];
  const lastP = participants[participants.length - 1];
  if (firstP && lastP) {
    const noteLabel = workflow.description
      ? `${workflow.id} — ${workflow.description}`
      : workflow.id;
    lines.push(`${indent}Note over ${firstP.alias},${lastP.alias}: ${noteLabel}`);
  }

  if (workflow.trigger && externals.some((ep) => ep.kind === "actor")) {
    const actor = externals.find((ep) => ep.kind === "actor")!;
    const actorAlias = participantAlias(participants, actor.id);
    const firstAgent = participants.find((p) => p.group === "agents" || p.group === "audit");
    if (firstAgent) {
      lines.push(`${indent}${actorAlias}->>${firstAgent.alias}: ${workflow.trigger}`);
    }
  }

  let lastFromAgent: string | undefined;
  const grouped = groupSteps(workflow.steps);

  for (const g of grouped) {
    if (g.group && g.steps.length > 1) {
      lines.push("");
      lines.push(`${indent}par ${g.group}`);
      const parIndent = indent + "    ";
      for (let i = 0; i < g.steps.length; i++) {
        const { step } = g.steps[i];
        if (i > 0) lines.push(`${indent}and`);
        emitStep(step, participants, dsl, relatedTasks, lines, parIndent, lastFromAgent, (a) => { lastFromAgent = a; });
      }
      lines.push(`${indent}end`);
    } else {
      for (const { step } of g.steps) {
        lines.push("");
        emitStep(step, participants, dsl, relatedTasks, lines, indent, lastFromAgent, (a) => { lastFromAgent = a; });
      }
    }
  }

  lines.push("");
  lines.push(`${indent}end`);

  return lines.join("\n");
}

function emitStep(
  step: WorkflowStep,
  participants: ParticipantInfo[],
  dsl: Dsl,
  relatedTasks: Array<Task & { id: string }>,
  lines: string[],
  indent: string,
  lastFromAgent: string | undefined,
  setLastFromAgent: (a: string) => void,
): void {
  if (step.type === "delegate") {
    setLastFromAgent(step.from_agent);
    emitDelegateStep(step, participants, dsl, relatedTasks, lines, indent);
    if (step.retry) {
      emitRetryBlock(step.from_agent, step.retry, participants, relatedTasks, lines, indent);
    }
  } else if (step.type === "gate") {
    emitGateStep(step, participants, lastFromAgent, lines, indent);
  } else if (step.type === "handoff") {
    if (step.from_agent) setLastFromAgent(step.from_agent);
    emitHandoffStep(step, participants, dsl, relatedTasks, lines, indent);
    if (step.retry) {
      emitRetryBlock(step.from_agent, step.retry, participants, relatedTasks, lines, indent);
    }
  } else if (step.type === "validation") {
    emitValidationStep(step, participants, dsl, lastFromAgent, lines, indent);
  } else if (step.type === "decision") {
    emitDecisionStep(step, participants, lastFromAgent, lines, indent);
  }
}
