import { describe, expect, it } from "vitest";
import { DslSchema, type Dsl } from "../../src/schema/index.js";
import { lint } from "../../src/linter/linter.js";

function makeDsl(partial: Record<string, unknown>): Dsl {
  return DslSchema.parse({
    version: 1,
    system: { id: "s", name: "S", default_workflow_order: ["implement"] },
    ...partial,
  });
}

const agent = { role_name: "A", purpose: "P" };

describe("key casing rules", () => {
  it("warns on a non-kebab-case key in each section", () => {
    const dsl = makeDsl({
      agents: { mainArchitect: agent },
      tasks: {
        Implement_Feature: {
          description: "d",
          target_agent: "mainArchitect",
          workflow: "implement",
          invocation_handoff: "Task_Delegation",
          result_handoff: "Task_Delegation",
          input_artifacts: [],
        },
      },
      artifacts: { SpecMd: { type: "doc" } },
      tools: { MyTool: { kind: "cli", command: "my-tool" } },
      validations: {
        Check_Spec: { target_artifact: "SpecMd", kind: "schema", executor_type: "tool", executor: "MyTool", blocking: true },
      },
      handoff_types: { Task_Delegation: { version: 1, schema: {} } },
      policies: { NoForce: { when: {} } },
    });
    const casing = lint(dsl).filter((d) => d.ruleId.endsWith("-key-casing"));
    expect(casing).toEqual([
      { ruleId: "agent-key-casing", severity: "warning", path: "agents.mainArchitect", message: "Agent keys must use kebab-case" },
      { ruleId: "task-key-casing", severity: "warning", path: "tasks.Implement_Feature", message: "Task keys must use kebab-case" },
      { ruleId: "artifact-key-casing", severity: "warning", path: "artifacts.SpecMd", message: "Artifact keys must use kebab-case" },
      { ruleId: "tool-key-casing", severity: "warning", path: "tools.MyTool", message: "Tool keys must use kebab-case" },
      { ruleId: "validation-key-casing", severity: "warning", path: "validations.Check_Spec", message: "Validation keys must use kebab-case" },
      { ruleId: "handoff-type-key-casing", severity: "warning", path: "handoff_types.Task_Delegation", message: "Handoff type keys must use kebab-case" },
      { ruleId: "policy-key-casing", severity: "warning", path: "policies.NoForce", message: "Policy keys must use kebab-case" },
    ]);
  });

  it("passes kebab-case keys", () => {
    const dsl = makeDsl({ agents: { "main-architect": agent, "agent-1": agent } });
    expect(lint(dsl).filter((d) => d.ruleId.endsWith("-key-casing"))).toEqual([]);
  });
});

describe("artifact-editors-not-empty", () => {
  it("reports empty editors when another deprecated ownership field is set", () => {
    const dsl = makeDsl({
      agents: { implementer: agent },
      artifacts: { codebase: { type: "code", owner: "implementer" } },
    });
    expect(lint(dsl).filter((d) => d.ruleId === "artifact-editors-not-empty")).toEqual([
      {
        ruleId: "artifact-editors-not-empty",
        severity: "info",
        path: "artifacts.codebase.editors",
        message: "editors must not be empty",
      },
    ]);
  });

  it("skips empty editors when all deprecated ownership fields are empty", () => {
    const dsl = makeDsl({ artifacts: { codebase: { type: "code" } } });
    expect(lint(dsl).filter((d) => d.ruleId === "artifact-editors-not-empty")).toEqual([]);
  });
});
