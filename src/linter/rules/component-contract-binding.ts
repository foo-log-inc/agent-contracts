import type { Dsl } from "../../schema/index.js";
import { loadComponentContractSlots } from "../../navigation-index/component-contract-loader.js";
import type { LintRule, LintDiagnostic } from "../types.js";

export const componentContractBindingRule: LintRule = {
  id: "component-contract-binding",
  description:
    "Check that artifact_bindings cover all slots referenced in the component contract",

  run(dsl: Dsl): LintDiagnostic[] {
    const diagnostics: LintDiagnostic[] = [];

    for (const [toolId, tool] of Object.entries(dsl.tools)) {
      if (!tool.component_contract || !tool.artifact_bindings) continue;

      const command = tool.command ?? "";
      const slotInfo = loadComponentContractSlots(tool.component_contract, command);
      if (!slotInfo?.artifactSlots) continue;

      const boundSlots = new Set(Object.keys(tool.artifact_bindings));

      for (const slot of Object.keys(slotInfo.artifactSlots)) {
        if (boundSlots.has(slot)) continue;

        diagnostics.push({
          ruleId: "component-contract-binding",
          severity: "warning",
          path: `tools.${toolId}.artifact_bindings`,
          message: `Component contract references slot "${slot}" but tool has no artifact_bindings entry for it`,
        });
      }
    }

    return diagnostics;
  },
};
