import type { Dsl } from "../../schema/index.js";
import {
  loadCliContractSlots,
  resolveSlotDirection,
} from "../../navigation-index/cli-contract-loader.js";
import type { LintRule, LintDiagnostic } from "../types.js";

function agentCanWriteArtifact(
  agentId: string,
  artifactId: string,
  dsl: Dsl,
): boolean {
  const agent = dsl.agents[agentId];
  if (!agent) return false;

  return (
    agent.can_write_artifacts.includes(artifactId) ||
    agent.own_artifacts.includes(artifactId)
  );
}

export const bindingDirectionMatchRule: LintRule = {
  id: "binding-direction-match",
  description:
    "Check that agents invoking a tool can write artifacts bound via write slots",

  run(dsl: Dsl): LintDiagnostic[] {
    const diagnostics: LintDiagnostic[] = [];

    for (const [toolId, tool] of Object.entries(dsl.tools)) {
      if (!tool.cli_contract || !tool.artifact_bindings) continue;

      const slotInfo = loadCliContractSlots(tool.cli_contract);
      if (!slotInfo) continue;

      const command = tool.command ?? "";

      for (const [slot, artifactId] of Object.entries(tool.artifact_bindings)) {
        const direction = resolveSlotDirection(slot, command, slotInfo);
        if (direction !== "write") continue;

        for (const agentId of tool.invokable_by) {
          if (agentCanWriteArtifact(agentId, artifactId, dsl)) continue;

          diagnostics.push({
            ruleId: "binding-direction-match",
            severity: "warning",
            path: `tools.${toolId}.artifact_bindings.${slot}`,
            message: `Agent "${agentId}" invokes tool "${toolId}" which writes to artifact "${artifactId}" via slot "${slot}", but agent lacks can_write_artifacts or own_artifacts for it`,
          });
        }
      }
    }

    return diagnostics;
  },
};
