import type { Dsl } from "../../schema/index.js";
import type { LintRule, LintDiagnostic } from "../types.js";

export const artifactOwnershipRule: LintRule = {
  id: "artifact-ownership",
  description:
    "Ensure execution_step produces/reads operations are consistent with artifact producers/editors/consumers",

  run(dsl: Dsl): LintDiagnostic[] {
    const diagnostics: LintDiagnostic[] = [];

    for (const [taskId, task] of Object.entries(dsl.tasks)) {
      if (!task.execution_steps) continue;
      const agentId = task.target_agent;

      for (const step of task.execution_steps) {
        if (step.produces_artifact) {
          const artifact = dsl.artifacts[step.produces_artifact];
          if (artifact && (artifact.producers.length > 0 || artifact.editors.length > 0)) {
            const canWrite =
              artifact.producers.includes(agentId) ||
              artifact.editors.includes(agentId);
            if (!canWrite) {
              diagnostics.push({
                ruleId: "artifact-ownership",
                severity: "warning",
                path: `tasks.${taskId}.execution_steps`,
                message: `Agent "${agentId}" produces artifact "${step.produces_artifact}" but is not listed in its producers or editors`,
              });
            }
          }
        }

        if (step.reads_artifact) {
          const artifact = dsl.artifacts[step.reads_artifact];
          const hasDeprecatedOwnership =
            !!artifact?.owner ||
            (artifact?.producers.length ?? 0) > 0 ||
            (artifact?.editors.length ?? 0) > 0 ||
            (artifact?.consumers.length ?? 0) > 0;
          if (artifact && hasDeprecatedOwnership) {
            const canRead =
              artifact.consumers.includes(agentId) ||
              artifact.producers.includes(agentId) ||
              artifact.editors.includes(agentId);
            if (!canRead) {
              diagnostics.push({
                ruleId: "artifact-ownership",
                severity: "warning",
                path: `tasks.${taskId}.execution_steps`,
                message: `Agent "${agentId}" reads artifact "${step.reads_artifact}" but is not listed in its producers, editors, or consumers`,
              });
            }
          }
        }
      }
    }

    return diagnostics;
  },
};
