import type { Dsl } from "../../schema/index.js";
import type { LintRule, LintDiagnostic } from "../types.js";

export const memoryConsistencyRule: LintRule = {
  id: "memory-consistency",
  description:
    "Validate memory capability declarations are internally consistent",

  run(dsl: Dsl): LintDiagnostic[] {
    const diagnostics: LintDiagnostic[] = [];

    for (const [agentId, agent] of Object.entries(dsl.agents)) {
      const memory = (agent as Record<string, unknown>).memory as
        | { resumable?: boolean; ref_required?: boolean; emits_memory_ref?: boolean }
        | undefined;
      if (!memory) continue;

      if (memory.resumable && !memory.emits_memory_ref) {
        diagnostics.push({
          ruleId: "memory-consistency",
          severity: "warning",
          path: `agents.${agentId}.memory`,
          message: `Agent "${agentId}" declares memory.resumable but does not declare emits_memory_ref — resumed sessions will not produce a memory_ref for downstream continuation`,
        });
      }

      if (memory.ref_required && !memory.resumable) {
        diagnostics.push({
          ruleId: "memory-consistency",
          severity: "error",
          path: `agents.${agentId}.memory`,
          message: `Agent "${agentId}" declares memory.ref_required but resumable is not true — ref_required requires resumable capability`,
        });
      }
    }

    return diagnostics;
  },
};
