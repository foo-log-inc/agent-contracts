import { type RulesetDefinition } from "@stoplight/spectral-core";
import { truthy, casing, enumeration } from "@stoplight/spectral-functions";
import refExists from "./functions/ref-exists.js";
import editorsNotEmpty from "./functions/editors-not-empty.js";
import readonlyNoWrites from "./functions/readonly-no-writes.js";
import prerequisiteReadable from "./functions/prerequisite-readable.js";
import payloadSchemaIntegrity from "./functions/payload-schema-integrity.js";
import workflowHandoffKindExists from "./functions/workflow-handoff-kind-exists.js";

const ruleset: RulesetDefinition = {
  rules: {
    // ========== 15.2.1 Reference integrity ==========

    "artifact-owner-ref": {
      description: "Artifact owner must reference an existing agent",
      message: "{{error}}",
      severity: "error",
      given: "$.artifacts.*",
      then: {
        field: "owner",
        function: refExists,
        functionOptions: { referenceTo: "agents" },
      },
    },

    "artifact-producers-ref": {
      description: "(deprecated) Artifact producers must reference existing agents",
      message: "{{error}}",
      severity: "warn",
      given: "$.artifacts.*",
      then: {
        field: "producers",
        function: refExists,
        functionOptions: { referenceTo: "agents" },
      },
    },

    "artifact-editors-ref": {
      description: "(deprecated) Artifact editors must reference existing agents",
      message: "{{error}}",
      severity: "warn",
      given: "$.artifacts.*",
      then: {
        field: "editors",
        function: refExists,
        functionOptions: { referenceTo: "agents" },
      },
    },

    "artifact-consumers-ref": {
      description: "(deprecated) Artifact consumers must reference existing agents",
      message: "{{error}}",
      severity: "warn",
      given: "$.artifacts.*",
      then: {
        field: "consumers",
        function: refExists,
        functionOptions: { referenceTo: "agents" },
      },
    },

    "artifact-required-validations-ref": {
      description:
        "Artifact required_validations must reference existing validations",
      message: "{{error}}",
      severity: "error",
      given: "$.artifacts.*",
      then: {
        field: "required_validations",
        function: refExists,
        functionOptions: { referenceTo: "validations" },
      },
    },

    "agent-can-invoke-agents-ref": {
      description: "can_invoke_agents must reference existing agents",
      message: "{{error}}",
      severity: "error",
      given: "$.agents.*",
      then: {
        field: "can_invoke_agents",
        function: refExists,
        functionOptions: { referenceTo: "agents" },
      },
    },

    "agent-can-read-artifacts-ref": {
      description: "can_read_artifacts must reference existing artifacts",
      message: "{{error}}",
      severity: "error",
      given: "$.agents.*",
      then: {
        field: "can_read_artifacts",
        function: refExists,
        functionOptions: { referenceTo: "artifacts" },
      },
    },

    "agent-can-write-artifacts-ref": {
      description: "can_write_artifacts must reference existing artifacts",
      message: "{{error}}",
      severity: "error",
      given: "$.agents.*",
      then: {
        field: "can_write_artifacts",
        function: refExists,
        functionOptions: { referenceTo: "artifacts" },
      },
    },

    "agent-can-execute-tools-ref": {
      description: "can_execute_tools must reference existing tools",
      message: "{{error}}",
      severity: "error",
      given: "$.agents.*",
      then: {
        field: "can_execute_tools",
        function: refExists,
        functionOptions: { referenceTo: "tools" },
      },
    },

    "agent-can-perform-validations-ref": {
      description:
        "can_perform_validations must reference existing validations",
      message: "{{error}}",
      severity: "error",
      given: "$.agents.*",
      then: {
        field: "can_perform_validations",
        function: refExists,
        functionOptions: { referenceTo: "validations" },
      },
    },

    "agent-can-return-handoffs-ref": {
      description: "can_return_handoffs must reference existing handoff_types",
      message: "{{error}}",
      severity: "error",
      given: "$.agents.*",
      then: {
        field: "can_return_handoffs",
        function: refExists,
        functionOptions: { referenceTo: "handoff_types" },
      },
    },

    "task-target-agent-ref": {
      description: "Task target_agent must reference an existing agent",
      message: "{{error}}",
      severity: "error",
      given: "$.tasks.*",
      then: {
        field: "target_agent",
        function: refExists,
        functionOptions: { referenceTo: "agents" },
      },
    },

    "task-allowed-from-agents-ref": {
      description: "Task allowed_from_agents must reference existing agents",
      message: "{{error}}",
      severity: "error",
      given: "$.tasks.*",
      then: {
        field: "allowed_from_agents",
        function: refExists,
        functionOptions: { referenceTo: "agents" },
      },
    },

    "task-invocation-handoff-ref": {
      description:
        "Task invocation_handoff must reference an existing handoff_type",
      message: "{{error}}",
      severity: "error",
      given: "$.tasks.*",
      then: {
        field: "invocation_handoff",
        function: refExists,
        functionOptions: { referenceTo: "handoff_types" },
      },
    },

    "task-result-handoff-ref": {
      description: "Task result_handoff must reference an existing handoff_type",
      message: "{{error}}",
      severity: "error",
      given: "$.tasks.*",
      then: {
        field: "result_handoff",
        function: refExists,
        functionOptions: { referenceTo: "handoff_types" },
      },
    },

    "task-input-artifacts-ref": {
      description: "Task input_artifacts must reference existing artifacts",
      message: "{{error}}",
      severity: "error",
      given: "$.tasks.*",
      then: {
        field: "input_artifacts",
        function: refExists,
        functionOptions: { referenceTo: "artifacts" },
      },
    },

    "task-validations-ref": {
      description: "Task validations must reference existing validations",
      message: "{{error}}",
      severity: "error",
      given: "$.tasks.*",
      then: {
        field: "validations",
        function: refExists,
        functionOptions: { referenceTo: "validations" },
      },
    },

    "validation-target-artifact-ref": {
      description:
        "Validation target_artifact must reference an existing artifact",
      message: "{{error}}",
      severity: "error",
      given: "$.validations.*",
      then: {
        field: "target_artifact",
        function: refExists,
        functionOptions: { referenceTo: "artifacts" },
      },
    },

    "tool-invokable-by-ref": {
      description: "(deprecated) Tool invokable_by must reference existing agents",
      message: "{{error}}",
      severity: "warn",
      given: "$.tools.*",
      then: {
        field: "invokable_by",
        function: refExists,
        functionOptions: { referenceTo: "agents" },
      },
    },

    // ========== 15.2.2 Artifact responsibility integrity ==========

    "artifact-editors-not-empty": {
      description: "(deprecated) Artifact editors must not be empty (15.2.2)",
      message: "{{error}}",
      severity: "info",
      given: "$.artifacts.*.editors",
      then: {
        function: editorsNotEmpty,
      },
    },

    "artifact-owner-exists": {
      description: "(deprecated) Every artifact must have an owner",
      severity: "off",
      given: "$.artifacts.*",
      then: {
        field: "owner",
        function: truthy,
      },
    },

    // ========== 15.2.5 Handoff integrity ==========

    "workflow-step-refs": {
      description:
        "Workflow step references (task, from_agent, gate_kind, handoff_kind, validation) must exist",
      message: "{{error}}",
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
      message: "{{error}}",
      severity: "error",
      given: "$.agents.*",
      then: {
        function: readonlyNoWrites,
      },
    },

    "agent-prerequisite-readable": {
      description:
        "Agent prerequisites target must be in can_read_artifacts",
      message: "{{error}}",
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
      message: "{{error}}",
      severity: "error",
      given: "$.handoff_types.*.schema",
      then: {
        function: payloadSchemaIntegrity,
      },
    },

    // ========== naming convention ==========

    "agent-key-casing": {
      description: "Agent keys must use kebab-case",
      severity: "warn",
      given: "$.agents",
      then: {
        field: "@key",
        function: casing,
        functionOptions: { type: "kebab" },
      },
    },

    "task-key-casing": {
      description: "Task keys must use kebab-case",
      severity: "warn",
      given: "$.tasks",
      then: {
        field: "@key",
        function: casing,
        functionOptions: { type: "kebab" },
      },
    },

    "artifact-key-casing": {
      description: "Artifact keys must use kebab-case",
      severity: "warn",
      given: "$.artifacts",
      then: {
        field: "@key",
        function: casing,
        functionOptions: { type: "kebab" },
      },
    },

    "tool-key-casing": {
      description: "Tool keys must use kebab-case",
      severity: "warn",
      given: "$.tools",
      then: {
        field: "@key",
        function: casing,
        functionOptions: { type: "kebab" },
      },
    },

    "validation-key-casing": {
      description: "Validation keys must use kebab-case",
      severity: "warn",
      given: "$.validations",
      then: {
        field: "@key",
        function: casing,
        functionOptions: { type: "kebab" },
      },
    },

    "handoff-type-key-casing": {
      description: "Handoff type keys must use kebab-case",
      severity: "warn",
      given: "$.handoff_types",
      then: {
        field: "@key",
        function: casing,
        functionOptions: { type: "kebab" },
      },
    },

    "policy-key-casing": {
      description: "Policy keys must use kebab-case",
      severity: "warn",
      given: "$.policies",
      then: {
        field: "@key",
        function: casing,
        functionOptions: { type: "kebab" },
      },
    },

    // ========== version ==========

    "version-must-be-1": {
      description: "DSL version must be 1",
      severity: "error",
      given: "$.version",
      then: {
        function: enumeration,
        functionOptions: { values: [1] },
      },
    },
  },
};

export default ruleset;
