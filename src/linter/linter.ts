import type { Dsl } from "../schema/index.js";
import type { LintRule, LintDiagnostic } from "./types.js";
import { validationCoverageRule } from "./rules/validation-coverage.js";
import { toolExecutionRule } from "./rules/tool-execution.js";
import { taskAgentBindingRule } from "./rules/task-agent-binding.js";
import { mergeIntegrityRule } from "./rules/merge-integrity.js";
import { artifactOwnershipRule } from "./rules/artifact-ownership.js";
import { toolCommandsRule } from "./rules/tool-commands.js";
import { guardrailPolicyCoverageRule } from "./rules/guardrail-policy-coverage.js";
import {
  guardrailPolicyActionStateUndefinedRule,
  systemStatesUnusedRule,
} from "./rules/guardrail-policy-action-state.js";
import { yamlReservedKeySafetyRule } from "./rules/yaml-reserved-key-safety.js";
import { artifactRequiredValidationWiringRule } from "./rules/artifact-required-validation-wiring.js";
import { taskOutputValidationCompletenessRule } from "./rules/task-output-validation-completeness.js";
import { semanticValidationPhaseCoverageRule } from "./rules/semantic-validation-phase-coverage.js";
import {
  entityGuardrailUndefinedRule,
  entityNoGuardrailsRule,
  guardrailOrphanedRule,
} from "./rules/entity-guardrail-binding.js";
import { validationExecutorNoContextRule } from "./rules/validation-executor-no-context.js";
import { artifactOwnershipConsistencyRule } from "./rules/artifact-ownership-consistency.js";
import { deprecatedOwnershipFieldsRule } from "./rules/deprecated-ownership-fields.js";
import {
  extensionDeclaredButUnusedRule,
  extensionScopeMismatchRule,
  extensionUndeclaredUsageRule,
} from "./rules/extension-consumption.js";
import { bindingCompletenessRule } from "./rules/binding-completeness.js";
import { bindingDirectionMatchRule } from "./rules/binding-direction-match.js";
import { slotDeclarationExistsRule } from "./rules/slot-declaration-exists.js";
import { configPathConsistencyRule } from "./rules/config-path-consistency.js";
import { memoryConsistencyRule } from "./rules/memory-consistency.js";

const builtinRules: LintRule[] = [
  validationCoverageRule,
  toolExecutionRule,
  taskAgentBindingRule,
  mergeIntegrityRule,
  artifactOwnershipRule,
  toolCommandsRule,
  guardrailPolicyCoverageRule,
  guardrailPolicyActionStateUndefinedRule,
  systemStatesUnusedRule,
  yamlReservedKeySafetyRule,
  artifactRequiredValidationWiringRule,
  taskOutputValidationCompletenessRule,
  semanticValidationPhaseCoverageRule,
  entityGuardrailUndefinedRule,
  entityNoGuardrailsRule,
  guardrailOrphanedRule,
  validationExecutorNoContextRule,
  artifactOwnershipConsistencyRule,
  deprecatedOwnershipFieldsRule,
  extensionDeclaredButUnusedRule,
  extensionScopeMismatchRule,
  extensionUndeclaredUsageRule,
  bindingCompletenessRule,
  bindingDirectionMatchRule,
  slotDeclarationExistsRule,
  configPathConsistencyRule,
  memoryConsistencyRule,
];

export function lint(
  dsl: Dsl,
  rules: LintRule[] = builtinRules,
): LintDiagnostic[] {
  const diagnostics: LintDiagnostic[] = [];
  for (const rule of rules) {
    diagnostics.push(...rule.run(dsl));
  }
  return diagnostics;
}

export { builtinRules };
