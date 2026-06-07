import type { Dsl } from "../../schema/index.js";
import type { LintRule, LintDiagnostic } from "../types.js";

const ARTIFACT_FIELDS = ["owner", "producers", "editors", "consumers"] as const;

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

export const deprecatedOwnershipFieldsRule: LintRule = {
  id: "deprecated-ownership-fields",
  description:
    "Warn when deprecated artifact-side ownership fields are used instead of declaring ownership on agents via own_artifacts, can_write_artifacts, and can_read_artifacts",

  run(dsl: Dsl): LintDiagnostic[] {
    const diagnostics: LintDiagnostic[] = [];

    for (const [artId, artifact] of Object.entries(dsl.artifacts)) {
      for (const field of ARTIFACT_FIELDS) {
        if (isArtifactFieldUsed(artifact, field)) {
          diagnostics.push({
            ruleId: "deprecated-ownership-fields",
            severity: "warning",
            path: `artifacts.${artId}.${field}`,
            message: `Artifact "${artId}" uses deprecated field "${field}". Declare ownership on agents via own_artifacts, can_write_artifacts, and can_read_artifacts instead.`,
          });
        }
      }
    }

    return diagnostics;
  },
};
