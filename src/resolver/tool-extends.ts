import type { Tool } from "../schema/tool.js";

export class ToolExtendsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolExtendsError";
  }
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? (value as string[]) : [];
}

function asRecord(value: unknown): Record<string, string> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, string>;
  }
  return {};
}

function asCommands(value: unknown): Tool["commands"] {
  return Array.isArray(value) ? (value as Tool["commands"]) : [];
}

function isUnset(value: unknown): boolean {
  return value === undefined || value === null;
}

function mergeToolFields(base: Tool, child: Tool): Tool {
  const merged: Tool = { ...child };

  merged.artifact_bindings = {
    ...asRecord(base.artifact_bindings),
    ...asRecord(child.artifact_bindings),
  };

  if (isUnset(child.kind) && !isUnset(base.kind)) {
    merged.kind = base.kind;
  }

  if (isUnset(child.cli_contract) && !isUnset(base.cli_contract)) {
    merged.cli_contract = base.cli_contract;
  }

  if (isUnset(child.component_contract) && !isUnset(base.component_contract)) {
    merged.component_contract = base.component_contract;
  }

  if (isUnset(child.description) && !isUnset(base.description)) {
    merged.description = base.description;
  }

  const childInvokableBy = asStringArray(child.invokable_by);
  const baseInvokableBy = asStringArray(base.invokable_by);
  if (childInvokableBy.length === 0 && baseInvokableBy.length > 0) {
    merged.invokable_by = [...baseInvokableBy];
  }

  const childInputArtifacts = asStringArray(child.input_artifacts);
  const baseInputArtifacts = asStringArray(base.input_artifacts);
  if (childInputArtifacts.length === 0 && baseInputArtifacts.length > 0) {
    merged.input_artifacts = [...baseInputArtifacts];
  }

  const childOutputArtifacts = asStringArray(child.output_artifacts);
  const baseOutputArtifacts = asStringArray(base.output_artifacts);
  if (childOutputArtifacts.length === 0 && baseOutputArtifacts.length > 0) {
    merged.output_artifacts = [...baseOutputArtifacts];
  }

  const childSideEffects = asStringArray(child.side_effects);
  const baseSideEffects = asStringArray(base.side_effects);
  if (childSideEffects.length === 0 && baseSideEffects.length > 0) {
    merged.side_effects = [...baseSideEffects];
  }

  const childCommands = asCommands(child.commands);
  const baseCommands = asCommands(base.commands);
  if (childCommands.length === 0 && baseCommands.length > 0) {
    merged.commands = [...baseCommands];
  }

  if (isUnset(child.guardrails) && !isUnset(base.guardrails)) {
    merged.guardrails = base.guardrails;
  }

  return merged;
}

function resolveToolChain(
  id: string,
  tools: Record<string, Tool>,
  resolving: Set<string>,
  resolved: Map<string, Tool>,
): Tool {
  const cached = resolved.get(id);
  if (cached !== undefined) {
    return cached;
  }

  const tool = tools[id];
  if (tool === undefined) {
    throw new ToolExtendsError(`Tool "${id}" not found`);
  }

  const extendsId = tool.extends;
  if (extendsId === undefined) {
    resolved.set(id, tool);
    return tool;
  }

  if (resolving.has(id)) {
    throw new ToolExtendsError(
      `Circular tool extends detected involving "${id}"`,
    );
  }

  const baseTool = tools[extendsId];
  if (baseTool === undefined) {
    resolved.set(id, tool);
    return tool;
  }

  resolving.add(id);
  try {
    const resolvedBase = resolveToolChain(
      extendsId,
      tools,
      resolving,
      resolved,
    );
    const merged = mergeToolFields(resolvedBase, tool);
    resolved.set(id, merged);
    return merged;
  } finally {
    resolving.delete(id);
  }
}

export function resolveToolExtends(
  tools: Record<string, Tool>,
): Record<string, Tool> {
  const resolved = new Map<string, Tool>();
  const result: Record<string, Tool> = {};

  for (const id of Object.keys(tools)) {
    result[id] = resolveToolChain(id, tools, new Set(), resolved);
  }

  return result;
}
