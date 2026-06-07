import type { Dsl } from "../../schema/index.js";
import {
  collectAgentArtifactConsumers,
  collectAgentArtifactProducers,
  normalizeDerivedFrom,
  resolveAgentEffects,
  isNarrowOnlyOverride,
  resolveTaskEffects,
} from "../../resolver/effects.js";
import { resolveToolExtends } from "../../resolver/tool-extends.js";
import type { LintRule, LintDiagnostic } from "../types.js";

export const artifactDataflowRule: LintRule = {
  id: "artifact-dataflow",
  description:
    "Check artifact producer/consumer coverage, derived_from consistency, and consumer read permissions",

  run(dsl: Dsl): LintDiagnostic[] {
    const diagnostics: LintDiagnostic[] = [];
    const resolvedTools = resolveToolExtends(dsl.tools);

    for (const [artifactId, artifact] of Object.entries(dsl.artifacts)) {
      const producers = collectAgentArtifactProducers(dsl, artifactId, resolvedTools);
      const consumers = collectAgentArtifactConsumers(dsl, artifactId, resolvedTools);

      if (producers.size === 0) {
        diagnostics.push({
          ruleId: "artifact-dataflow",
          severity: "warning",
          path: `artifacts.${artifactId}`,
          message: `Artifact "${artifactId}" has no agent or tool that produces it`,
        });
      }

      if (consumers.size === 0) {
        diagnostics.push({
          ruleId: "artifact-dataflow",
          severity: "warning",
          path: `artifacts.${artifactId}`,
          message: `Artifact "${artifactId}" has no agent or tool that consumes it`,
        });
      }

      for (const sourceId of normalizeDerivedFrom(artifact.derived_from)) {
        if (!dsl.artifacts[sourceId]) {
          diagnostics.push({
            ruleId: "artifact-dataflow",
            severity: "error",
            path: `artifacts.${artifactId}.derived_from`,
            message: `derived_from references non-existent artifact "${sourceId}"`,
          });
        }
      }

      for (const consumerId of artifact.consumers ?? []) {
        const agent = dsl.agents[consumerId];
        if (
          agent &&
          !agent.can_read_artifacts.includes(artifactId) &&
          !agent.can_write_artifacts.includes(artifactId) &&
          !agent.own_artifacts.includes(artifactId)
        ) {
          diagnostics.push({
            ruleId: "artifact-dataflow",
            severity: "error",
            path: `artifacts.${artifactId}.consumers`,
            message: `Agent "${consumerId}" consumes artifact "${artifactId}" but lacks read access (can_read_artifacts)`,
          });
        }
      }
    }

    for (const [agentId, agent] of Object.entries(dsl.agents)) {
      if (!agent.effects || agent.effects.length === 0) continue;
      const { derived } = resolveAgentEffects(dsl, agentId, resolvedTools);
      if (!isNarrowOnlyOverride(derived, agent.effects)) {
        diagnostics.push({
          ruleId: "artifact-dataflow",
          severity: "error",
          path: `agents.${agentId}.effects`,
          message: `Agent effects override contains values not present in derived tool effects`,
        });
      }
    }

    for (const [taskId, task] of Object.entries(dsl.tasks)) {
      if (!task.effects || task.effects.length === 0) continue;
      const { derived } = resolveTaskEffects(dsl, taskId, resolvedTools);
      if (!isNarrowOnlyOverride(derived, task.effects)) {
        diagnostics.push({
          ruleId: "artifact-dataflow",
          severity: "error",
          path: `tasks.${taskId}.effects`,
          message: `Task effects override contains values not present in derived tool effects`,
        });
      }
    }

    return diagnostics;
  },
};
