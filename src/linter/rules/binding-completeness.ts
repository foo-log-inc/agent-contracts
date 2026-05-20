import type { Dsl } from "../../schema/index.js";
import { loadCliContractSlots } from "../../navigation-index/cli-contract-loader.js";
import type { LintRule, LintDiagnostic } from "../types.js";

export const bindingCompletenessRule: LintRule = {
  id: "binding-completeness",
  description:
    "Check that artifact_bindings cover all slots referenced in the cli-contract command effects",

  run(dsl: Dsl): LintDiagnostic[] {
    const diagnostics: LintDiagnostic[] = [];

    for (const [toolId, tool] of Object.entries(dsl.tools)) {
      if (!tool.cli_contract || !tool.artifact_bindings) continue;

      const slotInfo = loadCliContractSlots(tool.cli_contract);
      if (!slotInfo?.artifactSlots) continue;

      const command = tool.command ?? "";
      const effects = slotInfo.commandEffects[command];
      if (!effects) continue;

      const referencedSlots = [...effects.reads, ...effects.writes];
      const boundSlots = new Set(Object.keys(tool.artifact_bindings));

      for (const slot of referencedSlots) {
        if (boundSlots.has(slot)) continue;

        diagnostics.push({
          ruleId: "binding-completeness",
          severity: "warning",
          path: `tools.${toolId}.artifact_bindings`,
          message: `Command "${command}" references slot "${slot}" but tool has no artifact_bindings entry for it`,
        });
      }
    }

    return diagnostics;
  },
};
