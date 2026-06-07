import type { Dsl, Agent, Task, Tool } from "../schema/index.js";
import { resolveToolExtends } from "./tool-extends.js";
import { loadCliContractSlots, resolveSlotDirection } from "../navigation-index/cli-contract-loader.js";

export interface EffectiveEffects {
  derived: string[];
  override?: string[];
  effective: string[];
}

function addEffect(set: Set<string>, effect: string): void {
  if (effect.length > 0) set.add(effect);
}

function collectToolEffects(tool: Tool): Set<string> {
  const effects = new Set<string>();

  for (const sideEffect of tool.side_effects ?? []) {
    addEffect(effects, sideEffect);
  }

  if (tool.cli_contract) {
    const command = tool.command ?? "";
    const slotInfo = loadCliContractSlots(tool.cli_contract);
    if (slotInfo) {
      for (const [slot, artifactId] of Object.entries(tool.artifact_bindings ?? {})) {
        const direction = resolveSlotDirection(slot, command, slotInfo);
        addEffect(effects, `${direction}:${artifactId}`);
      }
    }
  }

  for (const artifactId of tool.input_artifacts ?? []) {
    addEffect(effects, `read:${artifactId}`);
  }
  for (const artifactId of tool.output_artifacts ?? []) {
    addEffect(effects, `write:${artifactId}`);
  }

  for (const cmd of tool.commands ?? []) {
    for (const artifactId of cmd.reads ?? []) {
      addEffect(effects, `read:${artifactId}`);
    }
    for (const artifactId of cmd.writes ?? []) {
      addEffect(effects, `write:${artifactId}`);
    }
  }

  return effects;
}

function sortEffects(effects: Iterable<string>): string[] {
  return [...effects].sort();
}

function applyNarrowOverride(
  derived: string[],
  override: string[] | undefined,
): EffectiveEffects {
  if (!override || override.length === 0) {
    return { derived, effective: derived };
  }
  return { derived, override, effective: [...override].sort() };
}

export function resolveToolEffects(tool: Tool): string[] {
  return sortEffects(collectToolEffects(tool));
}

export function resolveAgentEffects(
  dsl: Dsl,
  agentId: string,
  resolvedTools?: Record<string, Tool>,
): EffectiveEffects {
  const agent = dsl.agents[agentId];
  if (!agent) {
    return { derived: [], effective: [] };
  }

  const tools = resolvedTools ?? resolveToolExtends(dsl.tools);
  const derived = new Set<string>();

  for (const toolId of agent.can_execute_tools ?? []) {
    const tool = tools[toolId];
    if (!tool) continue;
    for (const effect of collectToolEffects(tool)) {
      derived.add(effect);
    }
  }

  const derivedSorted = sortEffects(derived);
  return applyNarrowOverride(derivedSorted, agent.effects);
}

export function resolveTaskEffects(
  dsl: Dsl,
  taskId: string,
  resolvedTools?: Record<string, Tool>,
): EffectiveEffects {
  const task = dsl.tasks[taskId];
  if (!task) {
    return { derived: [], effective: [] };
  }

  const tools = resolvedTools ?? resolveToolExtends(dsl.tools);
  const derived = new Set<string>();

  const agentEffects = resolveAgentEffects(dsl, task.target_agent, tools);
  for (const effect of agentEffects.derived) {
    derived.add(effect);
  }

  for (const step of task.execution_steps ?? []) {
    if (!step.uses_tool) continue;
    const tool = tools[step.uses_tool];
    if (!tool) continue;
    for (const effect of collectToolEffects(tool)) {
      derived.add(effect);
    }
  }

  const derivedSorted = sortEffects(derived);
  return applyNarrowOverride(derivedSorted, task.effects);
}

export function isNarrowOnlyOverride(
  derived: string[],
  override: string[] | undefined,
): boolean {
  if (!override || override.length === 0) return true;
  const derivedSet = new Set(derived);
  return override.every((effect) => derivedSet.has(effect));
}

export function collectAgentArtifactProducers(
  dsl: Dsl,
  artifactId: string,
  resolvedTools?: Record<string, Tool>,
): Set<string> {
  const producers = new Set<string>();
  const tools = resolvedTools ?? resolveToolExtends(dsl.tools);

  for (const [agentId, agent] of Object.entries(dsl.agents)) {
    if (agent.can_write_artifacts.includes(artifactId)) {
      producers.add(`agent:${agentId}`);
    }
  }

  for (const [taskId, task] of Object.entries(dsl.tasks)) {
    for (const step of task.execution_steps ?? []) {
      if (step.produces_artifact === artifactId) {
        producers.add(`agent:${task.target_agent}`);
        producers.add(`task:${taskId}`);
      }
    }
  }

  for (const [toolId, tool] of Object.entries(tools)) {
    if (tool.output_artifacts.includes(artifactId)) {
      producers.add(`tool:${toolId}`);
    }
    if (tool.cli_contract) {
      const command = tool.command ?? "";
      const slotInfo = loadCliContractSlots(tool.cli_contract);
      if (slotInfo) {
        for (const [slot, boundArtifact] of Object.entries(tool.artifact_bindings ?? {})) {
          if (
            boundArtifact === artifactId &&
            resolveSlotDirection(slot, command, slotInfo) === "write"
          ) {
            producers.add(`tool:${toolId}`);
          }
        }
      }
    }
  }

  for (const producer of dsl.artifacts[artifactId]?.producers ?? []) {
    producers.add(`agent:${producer}`);
  }
  for (const editor of dsl.artifacts[artifactId]?.editors ?? []) {
    producers.add(`agent:${editor}`);
  }

  return producers;
}

export function collectAgentArtifactConsumers(
  dsl: Dsl,
  artifactId: string,
  resolvedTools?: Record<string, Tool>,
): Set<string> {
  const consumers = new Set<string>();
  const tools = resolvedTools ?? resolveToolExtends(dsl.tools);

  for (const [agentId, agent] of Object.entries(dsl.agents)) {
    if (agent.can_read_artifacts.includes(artifactId)) {
      consumers.add(`agent:${agentId}`);
    }
  }

  for (const [taskId, task] of Object.entries(dsl.tasks)) {
    if (task.input_artifacts.includes(artifactId)) {
      consumers.add(`agent:${task.target_agent}`);
      consumers.add(`task:${taskId}`);
    }
    for (const step of task.execution_steps ?? []) {
      if (step.reads_artifact === artifactId) {
        consumers.add(`agent:${task.target_agent}`);
        consumers.add(`task:${taskId}`);
      }
    }
  }

  for (const [toolId, tool] of Object.entries(tools)) {
    if (tool.input_artifacts.includes(artifactId)) {
      consumers.add(`tool:${toolId}`);
    }
    if (tool.cli_contract) {
      const command = tool.command ?? "";
      const slotInfo = loadCliContractSlots(tool.cli_contract);
      if (slotInfo) {
        for (const [slot, boundArtifact] of Object.entries(tool.artifact_bindings ?? {})) {
          if (
            boundArtifact === artifactId &&
            resolveSlotDirection(slot, command, slotInfo) === "read"
          ) {
            consumers.add(`tool:${toolId}`);
          }
        }
      }
    }
  }

  for (const consumer of dsl.artifacts[artifactId]?.consumers ?? []) {
    consumers.add(`agent:${consumer}`);
  }

  return consumers;
}

export function normalizeDerivedFrom(
  derivedFrom: string | string[] | undefined,
): string[] {
  if (!derivedFrom) return [];
  return Array.isArray(derivedFrom) ? derivedFrom : [derivedFrom];
}
