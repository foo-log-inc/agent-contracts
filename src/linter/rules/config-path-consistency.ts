import type { Dsl } from "../../schema/index.js";
import type { LintRule, LintDiagnostic } from "../types.js";

export const configPathConsistencyRule: LintRule = {
  id: "config-path-consistency",
  description:
    "Check that control-authority artifacts bound by tools have path_patterns defined",

  run(dsl: Dsl): LintDiagnostic[] {
    const diagnostics: LintDiagnostic[] = [];

    for (const [toolId, tool] of Object.entries(dsl.tools)) {
      if (!tool.artifact_bindings) continue;

      for (const [slot, artifactId] of Object.entries(tool.artifact_bindings)) {
        const artifact = dsl.artifacts[artifactId];
        if (!artifact || artifact.authority !== "control") continue;

        if (artifact.path_patterns && artifact.path_patterns.length > 0) continue;

        diagnostics.push({
          ruleId: "config-path-consistency",
          severity: "info",
          path: `tools.${toolId}.artifact_bindings.${slot}`,
          message: `Config artifact "${artifactId}" has no path_patterns; consider adding them for path-based lookup`,
        });
      }
    }

    return diagnostics;
  },
};
