import type { Dsl } from "../../schema/index.js";
import type { LintRule, LintDiagnostic } from "../types.js";

/**
 * Validation declares an executor, but the executor's prompt context would not
 * list this validation: agent must declare it in can_perform_validations; tool
 * must exist in the DSL (tool context reverse-resolves all tool-executor validations).
 */
export const validationExecutorNoContextRule: LintRule = {
  id: "validation-executor-no-context",
  description:
    "Validation executor is not wired so the validation appears in the executor's rendered context",

  run(dsl: Dsl): LintDiagnostic[] {
    const diagnostics: LintDiagnostic[] = [];

    for (const [validationId, val] of Object.entries(dsl.validations)) {
      if (!val.executor) continue;
      if (val.executor_type === "agent") {
        const agent = dsl.agents[val.executor];
        if (!agent) continue;
        const allowed = new Set(agent.can_perform_validations ?? []);
        if (!allowed.has(validationId)) {
          diagnostics.push({
            ruleId: "validation-executor-no-context",
            severity: "warning",
            path: `agents.${val.executor}.can_perform_validations`,
            message: `Validation "${validationId}" is executed by agent "${val.executor}" but is not listed in can_perform_validations, so it will be missing from that agent's prompt context`,
          });
        }
      } else if (val.executor_type === "tool") {
        if (!dsl.tools[val.executor]) {
          diagnostics.push({
            ruleId: "validation-executor-no-context",
            severity: "warning",
            path: `validations.${validationId}.executor`,
            message: `Validation "${validationId}" references tool executor "${val.executor}" which is not defined in tools`,
          });
        }
      }
    }

    return diagnostics;
  },
};
