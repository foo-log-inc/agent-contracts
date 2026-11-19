import type { DocumentRule } from "./types.js";
import refExists from "./functions/ref-exists.js";
import editorsNotEmpty from "./functions/editors-not-empty.js";
import readonlyNoWrites from "./functions/readonly-no-writes.js";
import prerequisiteReadable from "./functions/prerequisite-readable.js";
import payloadSchemaIntegrity from "./functions/payload-schema-integrity.js";
import workflowHandoffKindExists from "./functions/workflow-handoff-kind-exists.js";
import kebabCase from "./functions/kebab-case.js";
import oneOf from "./functions/one-of.js";

const ruleset: Record<string, DocumentRule> = {
  // ========== 15.2.1 Reference integrity ==========

  "artifact-owner-ref": {
    description: "Artifact owner must reference an existing agent",
    severity: "error",
    given: "$.artifacts.*",
    then: {
      field: "owner",
      function: refExists("agents"),
    },
  },

  "artifact-producers-ref": {
    description: "(deprecated) Artifact producers must reference existing agents",
    severity: "warning",
    given: "$.artifacts.*",
    then: {
      field: "producers",
      function: refExists("agents"),
    },
  },

  "artifact-editors-ref": {
    description: "(deprecated) Artifact editors must reference existing agents",
    severity: "warning",
    given: "$.artifacts.*",
    then: {
      field: "editors",
      function: refExists("agents"),
    },
  },

  "artifact-consumers-ref": {
    description: "(deprecated) Artifact consumers must reference existing agents",
    severity: "warning",
    given: "$.artifacts.*",
    then: {
      field: "consumers",
      function: refExists("agents"),
    },
  },

  "artifact-required-validations-ref": {
    description:
      "Artifact required_validations must reference existing validations",
    severity: "error",
    given: "$.artifacts.*",
    then: {
      field: "required_validations",
      function: refExists("validations"),
    },
  },

  "agent-can-invoke-agents-ref": {
    description: "can_invoke_agents must reference existing agents",
    severity: "error",
    given: "$.agents.*",
    then: {
      field: "can_invoke_agents",
      function: refExists("agents"),
    },
  },

  "agent-can-read-artifacts-ref": {
    description: "can_read_artifacts must reference existing artifacts",
    severity: "error",
    given: "$.agents.*",
    then: {
      field: "can_read_artifacts",
      function: refExists("artifacts"),
    },
  },

  "agent-can-write-artifacts-ref": {
    description: "can_write_artifacts must reference existing artifacts",
    severity: "error",
    given: "$.agents.*",
    then: {
      field: "can_write_artifacts",
      function: refExists("artifacts"),
    },
  },

  "agent-can-execute-tools-ref": {
    description: "can_execute_tools must reference existing tools",
    severity: "error",
    given: "$.agents.*",
    then: {
      field: "can_execute_tools",
      function: refExists("tools"),
    },
  },

  "agent-can-perform-validations-ref": {
    description:
      "can_perform_validations must reference existing validations",
    severity: "error",
    given: "$.agents.*",
    then: {
      field: "can_perform_validations",
      function: refExists("validations"),
    },
  },

  "agent-can-return-handoffs-ref": {
    description: "can_return_handoffs must reference existing handoff_types",
    severity: "error",
    given: "$.agents.*",
    then: {
      field: "can_return_handoffs",
      function: refExists("handoff_types"),
    },
  },

  "task-target-agent-ref": {
    description: "Task target_agent must reference an existing agent",
    severity: "error",
    given: "$.tasks.*",
    then: {
      field: "target_agent",
      function: refExists("agents"),
    },
  },

  "task-allowed-from-agents-ref": {
    description: "Task allowed_from_agents must reference existing agents",
    severity: "error",
    given: "$.tasks.*",
    then: {
      field: "allowed_from_agents",
      function: refExists("agents"),
    },
  },

  "task-invocation-handoff-ref": {
    description:
      "Task invocation_handoff must reference an existing handoff_type",
    severity: "error",
    given: "$.tasks.*",
    then: {
      field: "invocation_handoff",
      function: refExists("handoff_types"),
    },
  },

  "task-result-handoff-ref": {
    description: "Task result_handoff must reference an existing handoff_type",
    severity: "error",
    given: "$.tasks.*",
    then: {
      field: "result_handoff",
      function: refExists("handoff_types"),
    },
  },

  "task-input-artifacts-ref": {
    description: "Task input_artifacts must reference existing artifacts",
    severity: "error",
    given: "$.tasks.*",
    then: {
      field: "input_artifacts",
      function: refExists("artifacts"),
    },
  },

  "task-validations-ref": {
    description: "Task validations must reference existing validations",
    severity: "error",
    given: "$.tasks.*",
    then: {
      field: "validations",
      function: refExists("validations"),
    },
  },

  "validation-target-artifact-ref": {
    description:
      "Validation target_artifact must reference an existing artifact",
    severity: "error",
    given: "$.validations.*",
    then: {
      field: "target_artifact",
      function: refExists("artifacts"),
    },
  },

  "tool-invokable-by-ref": {
    description: "(deprecated) Tool invokable_by must reference existing agents",
    severity: "warning",
    given: "$.tools.*",
    then: {
      field: "invokable_by",
      function: refExists("agents"),
    },
  },

  // ========== 15.2.2 Artifact responsibility integrity ==========

  "artifact-editors-not-empty": {
    description: "(deprecated) Artifact editors must not be empty (15.2.2)",
    severity: "info",
    given: "$.artifacts.*.editors",
    then: {
      function: editorsNotEmpty,
    },
  },

  // ========== 15.2.5 Handoff integrity ==========

  "workflow-step-refs": {
    description:
      "Workflow step references (task, from_agent, gate_kind, handoff_kind, validation) must exist",
    severity: "error",
    given: "$.workflow.*",
    then: {
      function: workflowHandoffKindExists,
    },
  },

  // ========== 15.2.7 Agent behavioral spec integrity ==========

  "readonly-agent-no-writes": {
    description:
      'Agent with mode "read-only" must have empty can_write_artifacts',
    severity: "error",
    given: "$.agents.*",
    then: {
      function: readonlyNoWrites,
    },
  },

  "agent-prerequisite-readable": {
    description:
      "Agent prerequisites target must be in can_read_artifacts",
    severity: "error",
    given: "$.agents.*",
    then: {
      function: prerequisiteReadable,
    },
  },

  // ========== 15.2.10 Handoff schema integrity ==========

  "handoff-payload-integrity": {
    description:
      "Handoff schema required/properties consistency, enum non-empty, nested validation",
    severity: "error",
    given: "$.handoff_types.*.schema",
    then: {
      function: payloadSchemaIntegrity,
    },
  },

  // ========== naming convention ==========

  "agent-key-casing": {
    description: "Agent keys must use kebab-case",
    severity: "warning",
    given: "$.agents",
    then: {
      field: "@key",
      function: kebabCase,
    },
  },

  "task-key-casing": {
    description: "Task keys must use kebab-case",
    severity: "warning",
    given: "$.tasks",
    then: {
      field: "@key",
      function: kebabCase,
    },
  },

  "artifact-key-casing": {
    description: "Artifact keys must use kebab-case",
    severity: "warning",
    given: "$.artifacts",
    then: {
      field: "@key",
      function: kebabCase,
    },
  },

  "tool-key-casing": {
    description: "Tool keys must use kebab-case",
    severity: "warning",
    given: "$.tools",
    then: {
      field: "@key",
      function: kebabCase,
    },
  },

  "validation-key-casing": {
    description: "Validation keys must use kebab-case",
    severity: "warning",
    given: "$.validations",
    then: {
      field: "@key",
      function: kebabCase,
    },
  },

  "handoff-type-key-casing": {
    description: "Handoff type keys must use kebab-case",
    severity: "warning",
    given: "$.handoff_types",
    then: {
      field: "@key",
      function: kebabCase,
    },
  },

  "policy-key-casing": {
    description: "Policy keys must use kebab-case",
    severity: "warning",
    given: "$.policies",
    then: {
      field: "@key",
      function: kebabCase,
    },
  },

  // ========== version ==========

  "version-must-be-1": {
    description: "DSL version must be 1",
    severity: "error",
    given: "$.version",
    then: {
      function: oneOf([1]),
    },
  },
};

export default ruleset;
