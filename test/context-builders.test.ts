import { describe, it, expect } from "vitest";
import type { Dsl } from "../src/schema/index.js";
import {
  buildSystemContext,
  buildPerAgentContext,
  buildTaskContext,
  buildArtifactContext,
  buildToolContext,
  buildValidationContext,
  buildHandoffTypeContext,
  buildWorkflowContext,
  buildPolicyContext,
  buildGuardrailContext,
  buildGuardrailPolicyContext,
} from "../src/renderer/context.js";
import type { EntityValidationEntry } from "../src/renderer/context.js";

function createMinimalDsl(): Dsl {
  return {
    version: 1,
    system: {
      id: "test-system",
      name: "Test System",
      default_workflow_order: ["plan", "implement"],
    },
    agents: {
      dev: {
        role_name: "Developer",
        purpose: "Write code",
        can_read_artifacts: ["source-code"],
        can_write_artifacts: ["source-code"],
        can_execute_tools: ["lint"],
        can_perform_validations: [],
        can_invoke_agents: [],
        can_return_handoffs: ["task-result"],
      },
      reviewer: {
        role_name: "Reviewer",
        purpose: "Review code",
        can_read_artifacts: ["source-code"],
        can_write_artifacts: [],
        can_execute_tools: [],
        can_perform_validations: ["code-review"],
        can_invoke_agents: [],
        can_return_handoffs: ["task-result"],
      },
    },
    tasks: {
      "implement-feature": {
        description: "Implement a feature",
        target_agent: "dev",
        allowed_from_agents: ["reviewer"],
        workflow: "implement",
        input_artifacts: ["source-code"],
        invocation_handoff: "task-request",
        result_handoff: "task-result",
      },
      "review-code": {
        description: "Review code changes",
        target_agent: "reviewer",
        allowed_from_agents: ["dev"],
        workflow: "implement",
        input_artifacts: ["source-code"],
        invocation_handoff: "task-request",
        result_handoff: "task-result",
      },
    },
    artifacts: {
      "source-code": {
        type: "code",
        description: "Application source code",
        owner: "dev",
        producers: ["dev"],
        editors: ["dev"],
        consumers: ["reviewer"],
        states: ["draft", "reviewed"],
        required_validations: ["code-review"],
      },
    },
    tools: {
      lint: {
        kind: "static-analysis",
        description: "Run linter",
        input_artifacts: ["source-code"],
        output_artifacts: [],
        invokable_by: ["dev"],
        side_effects: [],
      },
    },
    validations: {
      "code-review": {
        target_artifact: "source-code",
        kind: "semantic",
        executor_type: "agent",
        executor: "reviewer",
        blocking: true,
      },
    },
    handoff_types: {
      "task-request": {
        version: 1,
        description: "Task invocation",
        schema: { properties: { message: { type: "string" } } },
      },
      "task-result": {
        version: 1,
        description: "Task result",
        schema: { properties: { result: { type: "string" } } },
      },
    },
    workflow: {
      plan: {
        entry_conditions: ["requirement exists"],
        steps: [
          { type: "handoff", handoff_kind: "task-request", task: "implement-feature" },
        ],
      },
      implement: {
        entry_conditions: [],
        steps: [
          { type: "validation", validation: "code-review" },
        ],
      },
    },
    policies: {
      "review-before-merge": {
        when: { artifact_type: "code" },
        requires_validations: ["code-review"],
      },
    },
    guardrails: {
      "no-force-push": {
        description: "Force push forbidden",
        scope: { tools: ["lint"] },
        tags: ["safety"],
      },
    },
    guardrail_policies: {
      default: {
        rules: [{ guardrail: "no-force-push", severity: "critical", action: "block" }],
      },
    },
  };
}

describe("buildSystemContext", () => {
  it("provides system and full dsl", () => {
    const dsl = createMinimalDsl();
    const ctx = buildSystemContext(dsl);
    expect(ctx.system).toBe(dsl.system);
    expect(ctx.dsl).toBe(dsl);
    expect(ctx.system.name).toBe("Test System");
  });
});

describe("buildPerAgentContext", () => {
  it("includes dsl reference", () => {
    const dsl = createMinimalDsl();
    const ctx = buildPerAgentContext(dsl, { ...dsl.agents["dev"], id: "dev" });
    expect(ctx.dsl).toBe(dsl);
    expect(ctx.agent.id).toBe("dev");
    expect(ctx.receivableTasks.length).toBeGreaterThan(0);
    expect(ctx.relatedTools).toHaveProperty("lint");
  });

  it("includes relatedValidations from can_perform_validations as full entries", () => {
    const dsl = createMinimalDsl();
    const ctx = buildPerAgentContext(dsl, { ...dsl.agents["reviewer"], id: "reviewer" });
    expect(ctx.relatedValidations).toHaveLength(1);
    const entry: EntityValidationEntry = ctx.relatedValidations[0];
    expect(entry.validation_id).toBe("code-review");
    expect(entry.kind).toBe("semantic");
    expect(entry.target_artifact).toBe("source-code");
    expect(entry.executor_type).toBe("agent");
    expect(entry.blocking).toBe(true);
  });

  it("includes handoff types from delegatable tasks", () => {
    const dsl = createMinimalDsl();
    dsl.handoff_types["delegation-request"] = {
      version: 1,
      description: "Delegation invocation",
      schema: { properties: { target: { type: "string" } } },
    };
    dsl.handoff_types["delegation-result"] = {
      version: 1,
      description: "Delegation result",
      schema: { properties: { status: { type: "string" } } },
    };
    dsl.tasks["delegated-work"] = {
      description: "Work delegated by coordinator",
      target_agent: "dev",
      allowed_from_agents: ["coordinator"],
      workflow: "implement",
      input_artifacts: [],
      invocation_handoff: "delegation-request",
      result_handoff: "delegation-result",
    };
    dsl.agents["coordinator"] = {
      role_name: "Coordinator",
      purpose: "Dispatch only",
      can_read_artifacts: [],
      can_write_artifacts: [],
      can_execute_tools: [],
      can_perform_validations: [],
      can_invoke_agents: ["dev"],
      can_return_handoffs: [],
    };
    const ctx = buildPerAgentContext(dsl, { ...dsl.agents["coordinator"], id: "coordinator" });
    expect(ctx.relatedHandoffTypes).toHaveProperty("delegation-request");
    expect(ctx.relatedHandoffTypes).toHaveProperty("delegation-result");
    expect(ctx.delegatableTasks).toHaveLength(1);
    expect(ctx.delegatableTasks[0].id).toBe("delegated-work");
  });

  it("propagates model_class to delegatableTasks", () => {
    const dsl = createMinimalDsl();
    dsl.tasks["implement-feature"].model_class = "thinking";
    const ctx = buildPerAgentContext(dsl, { ...dsl.agents["reviewer"], id: "reviewer" });
    const dt = ctx.delegatableTasks.find((t) => t.id === "implement-feature");
    expect(dt).toBeDefined();
    expect(dt!.model_class).toBe("thinking");
  });

  it("omits model_class from delegatableTasks when not set", () => {
    const dsl = createMinimalDsl();
    const ctx = buildPerAgentContext(dsl, { ...dsl.agents["reviewer"], id: "reviewer" });
    const dt = ctx.delegatableTasks.find((t) => t.id === "implement-feature");
    expect(dt).toBeDefined();
    expect(dt!.model_class).toBeUndefined();
  });

  it("has empty relatedValidations when agent runs no validations", () => {
    const dsl = createMinimalDsl();
    const ctx = buildPerAgentContext(dsl, { ...dsl.agents["dev"], id: "dev" });
    expect(ctx.relatedValidations).toHaveLength(0);
  });

  it("skips non-existent validation IDs in can_perform_validations", () => {
    const dsl = createMinimalDsl();
    const patched = {
      ...dsl,
      agents: {
        ...dsl.agents,
        dev: { ...dsl.agents.dev, can_perform_validations: ["not-a-validation", "code-review"] },
      },
    };
    const ctx = buildPerAgentContext(patched, { ...patched.agents["dev"], id: "dev" });
    expect(ctx.relatedValidations).toHaveLength(1);
    expect(ctx.relatedValidations[0].validation_id).toBe("code-review");
  });
});

describe("buildTaskContext", () => {
  it("provides task with id, target agent, and dsl", () => {
    const dsl = createMinimalDsl();
    const ctx = buildTaskContext(dsl, "implement-feature");
    expect(ctx.task.id).toBe("implement-feature");
    expect(ctx.task.description).toBe("Implement a feature");
    expect(ctx.targetAgent).not.toBeNull();
    expect(ctx.targetAgent!.id).toBe("dev");
    expect(ctx.dsl).toBe(dsl);
  });

  it("includes relatedValidations from task.validations as full entries", () => {
    const dsl = createMinimalDsl();
    const extended = {
      ...dsl,
      validations: {
        ...dsl.validations,
        "pre-merge-check": {
          target_artifact: "source-code",
          kind: "mechanical" as const,
          executor_type: "agent" as const,
          executor: "dev",
          blocking: false,
        },
      },
      tasks: {
        ...dsl.tasks,
        "implement-feature": {
          ...dsl.tasks["implement-feature"],
          validations: ["code-review", "pre-merge-check", "missing-val"],
        },
      },
    };
    const ctx = buildTaskContext(extended, "implement-feature");
    expect(ctx.relatedValidations).toHaveLength(2);
    const ids = ctx.relatedValidations.map((e) => e.validation_id).sort();
    expect(ids).toEqual(["code-review", "pre-merge-check"]);
  });

  it("has empty relatedValidations when task lists no validations", () => {
    const dsl = createMinimalDsl();
    const ctx = buildTaskContext(dsl, "review-code");
    expect(ctx.relatedValidations).toHaveLength(0);
  });
});

describe("buildArtifactContext", () => {
  it("provides artifact with id and dsl", () => {
    const dsl = createMinimalDsl();
    const ctx = buildArtifactContext(dsl, "source-code");
    expect(ctx.artifact.id).toBe("source-code");
    expect(ctx.artifact.type).toBe("code");
    expect(ctx.dsl).toBe(dsl);
  });

  it("includes relatedTools that reference the artifact as input or output", () => {
    const dsl = createMinimalDsl();
    const ctx = buildArtifactContext(dsl, "source-code");
    expect(ctx.relatedTools).toHaveProperty("lint");
  });

  it("includes relatedValidations targeting the artifact", () => {
    const dsl = createMinimalDsl();
    const ctx = buildArtifactContext(dsl, "source-code");
    expect(ctx.relatedValidations).toHaveProperty("code-review");
  });

  it("resolves producer, consumer, and editor agents", () => {
    const dsl = createMinimalDsl();
    const ctx = buildArtifactContext(dsl, "source-code");
    expect(ctx.producerAgents).toHaveProperty("dev");
    expect(ctx.consumerAgents).toHaveProperty("reviewer");
    expect(ctx.editorAgents).toHaveProperty("dev");
  });

  it("lists workflows where the artifact is written", () => {
    const dsl = createMinimalDsl();
    const ctx = buildArtifactContext(dsl, "source-code");
    expect(ctx.createdInWorkflows).toContain("implement");
  });
});

describe("buildToolContext", () => {
  it("provides tool with id and dsl", () => {
    const dsl = createMinimalDsl();
    const ctx = buildToolContext(dsl, "lint");
    expect(ctx.tool.id).toBe("lint");
    expect(ctx.tool.kind).toBe("static-analysis");
    expect(ctx.dsl).toBe(dsl);
  });

  it("resolves invokableAgents from invokable_by", () => {
    const dsl = createMinimalDsl();
    const ctx = buildToolContext(dsl, "lint");
    expect(ctx.invokableAgents).toHaveProperty("dev");
    expect(Object.keys(ctx.invokableAgents)).toHaveLength(1);
  });

  it("resolves input and output artifact details", () => {
    const dsl = createMinimalDsl();
    const ctx = buildToolContext(dsl, "lint");
    expect(ctx.inputArtifactDetails).toHaveProperty("source-code");
    expect(Object.keys(ctx.outputArtifactDetails)).toHaveLength(0);
  });

  it("includes relatedValidations for validations where this tool is executor", () => {
    const dsl = createMinimalDsl();
    const extended = {
      ...dsl,
      validations: {
        ...dsl.validations,
        "static-lint-gate": {
          target_artifact: "source-code",
          kind: "mechanical" as const,
          executor_type: "tool" as const,
          executor: "lint",
          blocking: true,
        },
      },
    };
    const ctx = buildToolContext(extended, "lint");
    expect(ctx.relatedValidations).toHaveLength(1);
    expect(ctx.relatedValidations[0].validation_id).toBe("static-lint-gate");
    expect(ctx.relatedValidations[0].executor_type).toBe("tool");
    expect(ctx.relatedValidations[0].target_artifact).toBe("source-code");
  });

  it("has empty relatedValidations when no tool-executor validations reference the tool", () => {
    const dsl = createMinimalDsl();
    const ctx = buildToolContext(dsl, "lint");
    expect(ctx.relatedValidations).toHaveLength(0);
  });
});

describe("buildValidationContext", () => {
  it("provides validation with id and dsl", () => {
    const dsl = createMinimalDsl();
    const ctx = buildValidationContext(dsl, "code-review");
    expect(ctx.validation.id).toBe("code-review");
    expect(ctx.validation.kind).toBe("semantic");
    expect(ctx.dsl).toBe(dsl);
  });
});

describe("buildHandoffTypeContext", () => {
  it("provides handoff type with related tasks", () => {
    const dsl = createMinimalDsl();
    const ctx = buildHandoffTypeContext(dsl, "task-request");
    expect(ctx.handoff_type.id).toBe("task-request");
    expect(ctx.relatedTasks.length).toBeGreaterThan(0);
    expect(ctx.dsl).toBe(dsl);
  });
});

describe("buildWorkflowContext", () => {
  it("provides workflow phase with id and dsl", () => {
    const dsl = createMinimalDsl();
    const ctx = buildWorkflowContext(dsl, "plan");
    expect(ctx.workflow.id).toBe("plan");
    expect(ctx.workflow.steps).toHaveLength(1);
    expect(ctx.dsl).toBe(dsl);
  });

  it("collects relatedTasks matching the workflow phase", () => {
    const dsl = createMinimalDsl();
    const ctx = buildWorkflowContext(dsl, "implement");
    const taskIds = ctx.relatedTasks.map((t) => t.id);
    expect(taskIds).toContain("implement-feature");
    expect(taskIds).toContain("review-code");
  });

  it("includes tasks referenced by workflow steps even from other phases", () => {
    const dsl = createMinimalDsl();
    const ctx = buildWorkflowContext(dsl, "plan");
    const taskIds = ctx.relatedTasks.map((t) => t.id);
    expect(taskIds).toContain("implement-feature");
    expect(taskIds).not.toContain("review-code");
  });

  it("collects relatedAgents from tasks and workflow steps", () => {
    const dsl = createMinimalDsl();
    const ctx = buildWorkflowContext(dsl, "implement");
    expect(ctx.relatedAgents).toHaveProperty("dev");
    expect(ctx.relatedAgents).toHaveProperty("reviewer");
  });

  it("collects relatedTools from agents involved in the phase", () => {
    const dsl = createMinimalDsl();
    const ctx = buildWorkflowContext(dsl, "implement");
    expect(ctx.relatedTools).toHaveProperty("lint");
  });

  it("collects relatedArtifacts from tasks and agents", () => {
    const dsl = createMinimalDsl();
    const ctx = buildWorkflowContext(dsl, "implement");
    expect(ctx.relatedArtifacts).toHaveProperty("source-code");
  });

  it("collects relatedValidations from workflow steps", () => {
    const dsl = createMinimalDsl();
    const ctx = buildWorkflowContext(dsl, "implement");
    expect(ctx.relatedValidations).toHaveProperty("code-review");
  });

  it("includes agent executor from validation step", () => {
    const dsl = createMinimalDsl();
    const ctx = buildWorkflowContext(dsl, "implement");
    expect(ctx.relatedAgents).toHaveProperty("reviewer");
  });
});

describe("buildPolicyContext", () => {
  it("provides policy with id and dsl", () => {
    const dsl = createMinimalDsl();
    const ctx = buildPolicyContext(dsl, "review-before-merge");
    expect(ctx.policy.id).toBe("review-before-merge");
    expect(ctx.policy.when.artifact_type).toBe("code");
    expect(ctx.dsl).toBe(dsl);
  });
});

describe("buildGuardrailContext", () => {
  it("provides guardrail with id and dsl", () => {
    const dsl = createMinimalDsl();
    const ctx = buildGuardrailContext(dsl, "no-force-push");
    expect(ctx.guardrail.id).toBe("no-force-push");
    expect(ctx.guardrail.description).toBe("Force push forbidden");
    expect(ctx.dsl).toBe(dsl);
  });
});

describe("buildGuardrailPolicyContext", () => {
  it("provides guardrail_policy with id and dsl", () => {
    const dsl = createMinimalDsl();
    const ctx = buildGuardrailPolicyContext(dsl, "default");
    expect(ctx.guardrail_policy.id).toBe("default");
    expect(ctx.guardrail_policy.rules).toHaveLength(1);
    expect(ctx.guardrail_policy.rules[0].guardrail).toBe("no-force-push");
    expect(ctx.dsl).toBe(dsl);
  });
});

describe("buildSystemContext with bindings", () => {
  function createBindingLoadedBinding() {
    return {
      filePath: "/test/binding.yaml",
      binding: {
        software: "cursor",
        version: 1 as const,
        guardrail_impl: {
          "no-force-push": {
            checks: [
              { matcher: { type: "command_regex" as const, pattern: "git push.*--force" }, message: "Force push blocked" },
            ],
          },
        },
      },
    };
  }

  it("returns basic context when no bindings provided", () => {
    const dsl = createMinimalDsl();
    const ctx = buildSystemContext(dsl);
    expect(ctx.guardrailEnforcement).toBeUndefined();
    expect(ctx.bindings).toBeUndefined();
  });

  it("returns basic context when empty bindings provided", () => {
    const dsl = createMinimalDsl();
    const ctx = buildSystemContext(dsl, { loadedBindings: [] });
    expect(ctx.guardrailEnforcement).toBeUndefined();
    expect(ctx.bindings).toBeUndefined();
  });

  it("includes bindings in context when provided", () => {
    const dsl = createMinimalDsl();
    const lb = createBindingLoadedBinding();
    const ctx = buildSystemContext(dsl, {
      loadedBindings: [lb],
      activeGuardrailPolicy: "default",
    });
    expect(ctx.bindings).toHaveLength(1);
    expect(ctx.bindings![0].software).toBe("cursor");
  });

  it("builds guardrailEnforcement from policy + bindings", () => {
    const dsl = createMinimalDsl();
    const lb = createBindingLoadedBinding();
    const ctx = buildSystemContext(dsl, {
      loadedBindings: [lb],
      activeGuardrailPolicy: "default",
    });
    expect(ctx.guardrailEnforcement).toBeDefined();
    expect(ctx.guardrailEnforcement).toHaveLength(1);
    const entry = ctx.guardrailEnforcement![0];
    expect(entry.guardrail_id).toBe("no-force-push");
    expect(entry.severity).toBe("critical");
    expect(entry.action).toBe("block");
    expect(entry.scoped_tools).toEqual(["lint"]);
    expect(entry.trigger).toBe("command_regex");
  });

  it("skips guardrailEnforcement when no active policy", () => {
    const dsl = createMinimalDsl();
    const lb = createBindingLoadedBinding();
    const ctx = buildSystemContext(dsl, {
      loadedBindings: [lb],
    });
    expect(ctx.guardrailEnforcement).toBeUndefined();
    expect(ctx.bindings).toHaveLength(1);
  });

  it("sets trigger to null when no binding implements the guardrail", () => {
    const dsl = createMinimalDsl();
    const lb = {
      filePath: "/test/binding.yaml",
      binding: { software: "cursor", version: 1 as const },
    };
    const ctx = buildSystemContext(dsl, {
      loadedBindings: [lb],
      activeGuardrailPolicy: "default",
    });
    expect(ctx.guardrailEnforcement).toHaveLength(1);
    expect(ctx.guardrailEnforcement![0].trigger).toBeNull();
  });
});
