import type { Dsl } from "../../schema/index.js";
import type { LintRule, LintDiagnostic } from "../types.js";

export const artifactOwnershipConsistencyRule: LintRule = {
  id: "artifact-ownership-consistency",
  description:
    "Ensure own_artifacts entries are included in can_read_artifacts and check deprecated owner field consistency",

  run(dsl: Dsl): LintDiagnostic[] {
    const diagnostics: LintDiagnostic[] = [];

    for (const [agentId, agent] of Object.entries(dsl.agents)) {
      if (agent.own_artifacts.length === 0) continue;

      for (const artId of agent.own_artifacts) {
        if (!agent.can_read_artifacts.includes(artId)) {
          diagnostics.push({
            ruleId: "artifact-ownership-consistency",
            severity: "warning",
            path: `agents.${agentId}.own_artifacts`,
            message: `Agent "${agentId}" owns artifact "${artId}" but does not include it in can_read_artifacts`,
          });
        }
      }
    }

    for (const [artId, art] of Object.entries(dsl.artifacts)) {
      if (!art.owner) continue;
      const ownerAgent = dsl.agents[art.owner];
      if (ownerAgent && !ownerAgent.own_artifacts.includes(artId)) {
        diagnostics.push({
          ruleId: "artifact-ownership-consistency",
          severity: "warning",
          path: `artifacts.${artId}.owner`,
          message: `Artifact "${artId}" has deprecated owner "${art.owner}" but agent does not list it in own_artifacts`,
        });
      }
    }

    return diagnostics;
  },
};
