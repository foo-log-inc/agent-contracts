import type { Dsl } from "../../schema/index.js";
import type { LintRule } from "../types.js";

const KEBAB_CASE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

type KeyedSection =
  | "agents"
  | "tasks"
  | "artifacts"
  | "tools"
  | "validations"
  | "handoff_types"
  | "policies";

/** Warns on each key of `section` that is not kebab-case (`agent-1`, `spec-md`). */
function keyCasingRule(id: string, section: KeyedSection, label: string): LintRule {
  const description = `${label} keys must use kebab-case`;
  return {
    id,
    description,
    run(dsl: Dsl) {
      return Object.keys(dsl[section])
        .filter((key) => key.length > 0 && !KEBAB_CASE.test(key))
        .map((key) => ({
          ruleId: id,
          severity: "warning" as const,
          path: `${section}.${key}`,
          message: description,
        }));
    },
  };
}

export const agentKeyCasingRule = keyCasingRule("agent-key-casing", "agents", "Agent");
export const taskKeyCasingRule = keyCasingRule("task-key-casing", "tasks", "Task");
export const artifactKeyCasingRule = keyCasingRule("artifact-key-casing", "artifacts", "Artifact");
export const toolKeyCasingRule = keyCasingRule("tool-key-casing", "tools", "Tool");
export const validationKeyCasingRule = keyCasingRule("validation-key-casing", "validations", "Validation");
export const handoffTypeKeyCasingRule = keyCasingRule("handoff-type-key-casing", "handoff_types", "Handoff type");
export const policyKeyCasingRule = keyCasingRule("policy-key-casing", "policies", "Policy");
