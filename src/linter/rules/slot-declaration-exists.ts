import type { Dsl } from "../../schema/index.js";
import { loadCliContractSlots } from "../../navigation-index/cli-contract-loader.js";
import type { LintRule, LintDiagnostic } from "../types.js";

export const slotDeclarationExistsRule: LintRule = {
  id: "slot-declaration-exists",
  description:
    "Check that artifact_bindings keys reference slot names declared in the cli-contract",

  run(dsl: Dsl): LintDiagnostic[] {
    const diagnostics: LintDiagnostic[] = [];

    for (const [toolId, tool] of Object.entries(dsl.tools)) {
      if (!tool.cli_contract || !tool.artifact_bindings) continue;

      const slotInfo = loadCliContractSlots(tool.cli_contract);
      if (!slotInfo?.artifactSlots) continue;

      for (const slot of Object.keys(tool.artifact_bindings)) {
        if (slot in slotInfo.artifactSlots) continue;

        diagnostics.push({
          ruleId: "slot-declaration-exists",
          severity: "warning",
          path: `tools.${toolId}.artifact_bindings.${slot}`,
          message: `artifact_bindings key "${slot}" is not declared in cli-contract artifactSlots`,
        });
      }
    }

    return diagnostics;
  },
};
