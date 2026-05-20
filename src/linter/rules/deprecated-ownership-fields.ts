import type { Dsl } from "../../schema/index.js";
import type { LintRule, LintDiagnostic } from "../types.js";

const ARTIFACT_FIELDS = ["owner", "producers", "editors", "consumers"] as const;
const AGENT_FIELDS = [
  "own_artifacts",
  "can_read_artifacts",
  "can_write_artifacts",
] as const;

function isArtifactFieldUsed(
  artifact: Dsl["artifacts"][string],
  field: (typeof ARTIFACT_FIELDS)[number],
): boolean {
  switch (field) {
    case "owner":
      return !!artifact.owner;
    case "producers":
      return artifact.producers.length > 0;
    case "editors":
      return artifact.editors.length > 0;
    case "consumers":
      return artifact.consumers.length > 0;
  }
}

function isAgentFieldUsed(
  agent: Dsl["agents"][string],
  field: (typeof AGENT_FIELDS)[number],
): boolean {
  switch (field) {
    case "own_artifacts":
      return agent.own_artifacts.length > 0;
    case "can_read_artifacts":
      return agent.can_read_artifacts.length > 0;
    case "can_write_artifacts":
      return agent.can_write_artifacts.length > 0;
  }
}

export const deprecatedOwnershipFieldsRule: LintRule = {
  id: "deprecated-ownership-fields",
  description:
    "Warn when deprecated ownership/permission fields are used instead of artifact_bindings + artifact_slots",

  run(dsl: Dsl): LintDiagnostic[] {
    const diagnostics: LintDiagnostic[] = [];

    for (const [artId, artifact] of Object.entries(dsl.artifacts)) {
      for (const field of ARTIFACT_FIELDS) {
        if (isArtifactFieldUsed(artifact, field)) {
          diagnostics.push({
            ruleId: "deprecated-ownership-fields",
            severity: "warning",
            path: `artifacts.${artId}.${field}`,
            message: `Artifact "${artId}" uses deprecated field "${field}". Ownership is derived from artifact_bindings + artifact_slots in the binding model.`,
          });
        }
      }
    }

    for (const [agentId, agent] of Object.entries(dsl.agents)) {
      for (const field of AGENT_FIELDS) {
        if (isAgentFieldUsed(agent, field)) {
          diagnostics.push({
            ruleId: "deprecated-ownership-fields",
            severity: "warning",
            path: `agents.${agentId}.${field}`,
            message: `Agent "${agentId}" uses deprecated field "${field}". Artifact permissions are derived from artifact_bindings + artifact_slots in the binding model.`,
          });
        }
      }
    }

    return diagnostics;
  },
};
