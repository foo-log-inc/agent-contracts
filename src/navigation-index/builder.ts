import type { Dsl, Tool } from "../schema/index.js";
import { resolveToolExtends } from "../resolver/tool-extends.js";
import { loadCliContractSlots, resolveSlotDirection } from "./cli-contract-loader.js";
import type {
  ArtifactOperation,
  ArtifactRoute,
  ArtifactRouteStep,
  CompiledArtifactNode,
  ProjectNavigationIndex,
} from "./types.js";

const VALIDATOR_KINDS = new Set(["linter", "checker", "validator", "test"]);
const VALIDATION_TERMS = ["lint", "check", "validate", "test", "verify", "audit"];

type ToolArtifactLink = {
  toolId: string;
  artifactId: string;
  direction: "read" | "write";
  slot: string;
  command: string;
};

function sortUnique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function matchesValidationTerm(value: string): boolean {
  const lower = value.toLowerCase();
  return VALIDATION_TERMS.some((term) => lower.includes(term));
}

function isValidatorTool(tool: Tool): boolean {
  if (tool.kind && VALIDATOR_KINDS.has(tool.kind)) {
    return true;
  }
  if (tool.command && matchesValidationTerm(tool.command)) {
    return true;
  }
  for (const cmd of tool.commands ?? []) {
    if (matchesValidationTerm(cmd.category) || matchesValidationTerm(cmd.command)) {
      return true;
    }
  }
  return false;
}

function extractToolArtifactLinks(
  toolId: string,
  tool: Tool,
): ToolArtifactLink[] {
  const links: ToolArtifactLink[] = [];

  if (tool.cli_contract) {
    const command = tool.command ?? "";
    const slotInfo = loadCliContractSlots(tool.cli_contract);

    for (const [slot, artifactId] of Object.entries(tool.artifact_bindings ?? {})) {
      const direction = slotInfo ? resolveSlotDirection(slot, command, slotInfo) : "read";

      links.push({
        toolId,
        artifactId,
        direction,
        slot,
        command,
      });
    }
    return links;
  }

  for (const cmd of tool.commands ?? []) {
    for (const artifactId of cmd.reads ?? []) {
      links.push({
        toolId,
        artifactId,
        direction: "read",
        slot: "",
        command: cmd.command,
      });
    }
    for (const artifactId of cmd.writes ?? []) {
      links.push({
        toolId,
        artifactId,
        direction: "write",
        slot: "",
        command: cmd.command,
      });
    }
  }

  return links;
}

function buildOperation(
  toolId: string,
  tool: Tool,
  link: ToolArtifactLink,
): ArtifactOperation {
  return {
    tool: toolId,
    cli_contract: tool.cli_contract ?? "",
    command: link.command || tool.command || "",
    slot: link.slot,
    invokable_by: [...(tool.invokable_by ?? [])],
  };
}

function operationKey(op: ArtifactOperation): string {
  return `${op.tool}:${op.command}:${op.slot}`;
}

function dedupeOperations(operations: ArtifactOperation[]): ArtifactOperation[] {
  const seen = new Set<string>();
  const result: ArtifactOperation[] = [];
  for (const op of operations) {
    const key = operationKey(op);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(op);
  }
  return result.sort((a, b) => a.tool.localeCompare(b.tool) || a.slot.localeCompare(b.slot));
}

function buildAgentMapping(
  dsl: Dsl,
  artifactId: string,
): CompiledArtifactNode["agents"] {
  const owners: string[] = [];
  const editors: string[] = [];
  const readers: string[] = [];

  for (const [agentId, agent] of Object.entries(dsl.agents)) {
    if (agent.own_artifacts?.includes(artifactId)) owners.push(agentId);
    if (agent.can_write_artifacts?.includes(artifactId)) editors.push(agentId);
    if (agent.can_read_artifacts?.includes(artifactId)) readers.push(agentId);
  }

  return {
    owners: sortUnique(owners),
    editors: sortUnique(editors),
    readers: sortUnique(readers),
  };
}

function buildRelations(
  artifactId: string,
  authority: CompiledArtifactNode["properties"]["authority"],
  linksByArtifact: Map<string, ToolArtifactLink[]>,
  allLinks: ToolArtifactLink[],
): CompiledArtifactNode["relations"] {
  const sourceArtifacts = new Set<string>();
  const derivedArtifacts = new Set<string>();

  const writesToThis = allLinks.filter(
    (link) => link.artifactId === artifactId && link.direction === "write",
  );

  if (authority === "generated" || authority === "derived") {
    for (const writeLink of writesToThis) {
      for (const readLink of allLinks) {
        if (readLink.toolId === writeLink.toolId && readLink.direction === "read") {
          sourceArtifacts.add(readLink.artifactId);
        }
      }
    }
  }

  const readsThis = allLinks.filter(
    (link) => link.artifactId === artifactId && link.direction === "read",
  );
  for (const readLink of readsThis) {
    for (const writeLink of allLinks) {
      if (writeLink.toolId === readLink.toolId && writeLink.direction === "write") {
        derivedArtifacts.add(writeLink.artifactId);
      }
    }
  }

  // Ensure we only reference known artifacts from the graph
  const knownArtifacts = new Set(linksByArtifact.keys());
  return {
    source_artifacts: sortUnique(
      [...sourceArtifacts].filter((id) => id !== artifactId && knownArtifacts.has(id)),
    ),
    derived_artifacts: sortUnique(
      [...derivedArtifacts].filter((id) => id !== artifactId && knownArtifacts.has(id)),
    ),
  };
}

function buildValidateRoutes(
  validators: ArtifactOperation[],
): ArtifactRoute[] {
  return validators.map((validator) => ({
    purpose: "validate" as const,
    steps: [
      {
        type: "run_operation" as const,
        operation: validator.tool,
        candidate_agents: [...validator.invokable_by],
      },
    ],
  }));
}

function buildRegenerateRoutes(
  sourceArtifacts: string[],
  producers: ArtifactOperation[],
  agentsByArtifact: Map<string, CompiledArtifactNode["agents"]>,
): ArtifactRoute[] {
  if (producers.length === 0) return [];

  const editSteps: ArtifactRouteStep[] = sourceArtifacts.map((artifactId) => ({
    type: "edit_artifact" as const,
    artifact: artifactId,
    candidate_agents: agentsByArtifact.get(artifactId)?.editors ?? [],
  }));

  const runSteps: ArtifactRouteStep[] = producers.map((producer) => ({
    type: "run_operation" as const,
    operation: producer.tool,
    candidate_agents: [...producer.invokable_by],
  }));

  return [
    {
      purpose: "regenerate",
      steps: [...editSteps, ...runSteps],
    },
  ];
}

function buildUpdateRoutes(
  artifactId: string,
  validators: ArtifactOperation[],
  editors: string[],
): ArtifactRoute[] {
  const steps: ArtifactRouteStep[] = [
    {
      type: "edit_artifact",
      artifact: artifactId,
      candidate_agents: [...editors],
    },
  ];

  for (const validator of validators) {
    steps.push({
      type: "run_operation",
      operation: validator.tool,
      candidate_agents: [...validator.invokable_by],
    });
  }

  return [
    {
      purpose: "update",
      steps,
    },
  ];
}

function defaultProperties(
  artifact: Dsl["artifacts"][string],
): CompiledArtifactNode["properties"] {
  return {
    type: artifact.type,
    authority: artifact.authority ?? "canonical",
    manual_edit: artifact.manual_edit ?? "allowed",
    change_control: artifact.change_control ?? "none",
  };
}

export function buildNavigationIndex(dsl: Dsl): ProjectNavigationIndex {
  const resolvedTools = resolveToolExtends(dsl.tools);
  const allLinks: ToolArtifactLink[] = [];

  for (const [toolId, tool] of Object.entries(resolvedTools)) {
    allLinks.push(...extractToolArtifactLinks(toolId, tool));
  }

  const linksByArtifact = new Map<string, ToolArtifactLink[]>();
  for (const link of allLinks) {
    const existing = linksByArtifact.get(link.artifactId) ?? [];
    existing.push(link);
    linksByArtifact.set(link.artifactId, existing);
  }

  const toolWrites = new Map<string, Set<string>>();
  for (const link of allLinks) {
    if (link.direction !== "write") continue;
    const writes = toolWrites.get(link.toolId) ?? new Set<string>();
    writes.add(link.artifactId);
    toolWrites.set(link.toolId, writes);
  }

  const artifacts: Record<string, CompiledArtifactNode> = {};
  const agentsByArtifact = new Map<string, CompiledArtifactNode["agents"]>();

  for (const [artifactId, artifactDef] of Object.entries(dsl.artifacts)) {
    // Artifacts are read from the caller-supplied DSL. When artifact_binding is
    // configured, pass Bound DSL from resolveBound() so merged path_patterns apply.
    const properties = defaultProperties(artifactDef);
    const agents = buildAgentMapping(dsl, artifactId);
    agentsByArtifact.set(artifactId, agents);

    const artifactLinks = linksByArtifact.get(artifactId) ?? [];
    const producers: ArtifactOperation[] = [];
    const validators: ArtifactOperation[] = [];
    const consumers: ArtifactOperation[] = [];

    const processedPairs = new Set<string>();

    for (const link of artifactLinks) {
      const tool = resolvedTools[link.toolId];
      if (!tool) continue;

      const pairKey = `${link.toolId}:${link.direction}:${link.slot}:${link.command}`;
      if (processedPairs.has(pairKey)) continue;
      processedPairs.add(pairKey);

      const operation = buildOperation(link.toolId, tool, link);
      const toolWritesArtifacts = toolWrites.get(link.toolId) ?? new Set<string>();

      if (link.direction === "write" || toolWritesArtifacts.has(artifactId)) {
        producers.push(operation);
      } else if (isValidatorTool(tool)) {
        validators.push(operation);
      } else if (link.direction === "read") {
        consumers.push(operation);
      }
    }

    const relations = buildRelations(
      artifactId,
      properties.authority,
      linksByArtifact,
      allLinks,
    );

    const routes: CompiledArtifactNode["routes"] = {};
    const dedupedValidators = dedupeOperations(validators);
    const dedupedProducers = dedupeOperations(producers);

    if (dedupedValidators.length > 0) {
      routes.validate = buildValidateRoutes(dedupedValidators);
    }

    if (
      properties.authority === "generated" &&
      dedupedProducers.length > 0 &&
      relations.source_artifacts.length > 0
    ) {
      routes.regenerate = buildRegenerateRoutes(
        relations.source_artifacts,
        dedupedProducers,
        agentsByArtifact,
      );
    }

    if (properties.authority === "canonical") {
      routes.update = buildUpdateRoutes(artifactId, dedupedValidators, agents.editors);
    }

    artifacts[artifactId] = {
      id: artifactId,
      files: {
        path_patterns: artifactDef.path_patterns ?? [],
        exclude_patterns: artifactDef.exclude_patterns ?? [],
      },
      properties,
      relations,
      operations: {
        producers: dedupeOperations(producers),
        validators: dedupedValidators,
        consumers: dedupeOperations(consumers),
      },
      agents,
      routes,
    };
  }

  return {
    version: "1.0.0",
    generated_at: new Date().toISOString(),
    system: {
      id: dsl.system.id,
      name: dsl.system.name,
    },
    artifacts,
  };
}
