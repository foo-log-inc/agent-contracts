import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { parse as parseYaml } from "yaml";
import { describe, it, expect } from "vitest";
import { DslSchema, type Dsl } from "../../src/schema/index.js";
import { lint } from "../../src/linter/linter.js";
import { validationCoverageRule } from "../../src/linter/rules/validation-coverage.js";
import { toolExecutionRule } from "../../src/linter/rules/tool-execution.js";
import { taskAgentBindingRule } from "../../src/linter/rules/task-agent-binding.js";
import { mergeIntegrityRule } from "../../src/linter/rules/merge-integrity.js";
import { artifactRequiredValidationWiringRule } from "../../src/linter/rules/artifact-required-validation-wiring.js";
import { taskOutputValidationCompletenessRule } from "../../src/linter/rules/task-output-validation-completeness.js";
import { semanticValidationPhaseCoverageRule } from "../../src/linter/rules/semantic-validation-phase-coverage.js";
import { deprecatedOwnershipFieldsRule } from "../../src/linter/rules/deprecated-ownership-fields.js";
import { memoryConsistencyRule } from "../../src/linter/rules/memory-consistency.js";

const fixturesDir = resolve(import.meta.dirname, "../fixtures");

function loadDsl(rel: string): Dsl {
  const data = parseYaml(readFileSync(join(fixturesDir, rel), "utf8"));
  return DslSchema.parse(data);
}

function makeDsl(partial: Partial<Record<string, unknown>>): Dsl {
  return DslSchema.parse({
    version: 1,
    system: { id: "s", name: "S", default_workflow_order: ["implement"] },
    ...partial,
  });
}

describe("validationCoverageRule", () => {
  it("warns when artifact has no validations", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P" } },
      artifacts: {
        art1: { type: "code", owner: "a1", producers: ["a1"], editors: ["a1"], consumers: ["a1"], states: ["draft"] },
      },
    });
    const diags = validationCoverageRule.run(dsl);
    expect(diags.length).toBeGreaterThan(0);
    expect(diags[0].severity).toBe("warning");
    expect(diags[0].message).toContain("no validations");
  });

  it("warns when code artifact lacks mechanical validation", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P" } },
      artifacts: {
        art1: { type: "code", owner: "a1", producers: ["a1"], editors: ["a1"], consumers: ["a1"], states: ["draft"] },
      },
      validations: {
        v1: { target_artifact: "art1", kind: "approval", executor_type: "agent", executor: "a1", blocking: true },
      },
    });
    const diags = validationCoverageRule.run(dsl);
    expect(diags.some((d) => d.message.includes("mechanical"))).toBe(true);
  });

  it("passes when artifact has mechanical validation", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P" } },
      artifacts: {
        art1: {
          type: "code", owner: "a1", producers: ["a1"], editors: ["a1"], consumers: ["a1"], states: ["draft"],
          required_validations: ["v1"],
        },
      },
      validations: {
        v1: { target_artifact: "art1", kind: "mechanical", executor_type: "tool", executor: "t1", blocking: true },
      },
      tools: { t1: { kind: "cli", invokable_by: ["a1"] } },
      workflow: { implement: { steps: [{ type: "validation", validation: "v1" }] } },
    });
    const diags = validationCoverageRule.run(dsl);
    expect(diags).toHaveLength(0);
  });

  it("warns when blocking validation is not referenced in workflow", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P" } },
      artifacts: {
        art1: { type: "doc", owner: "a1", producers: ["a1"], editors: ["a1"], consumers: ["a1"], states: ["draft"] },
      },
      validations: {
        v1: { target_artifact: "art1", kind: "approval", executor_type: "agent", executor: "a1", blocking: true },
      },
    });
    const diags = validationCoverageRule.run(dsl);
    expect(diags.some((d) => d.message.includes("Blocking validation") && d.message.includes("not referenced"))).toBe(true);
  });

  it("passes when blocking validation is referenced in workflow", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P" } },
      artifacts: {
        art1: { type: "doc", owner: "a1", producers: ["a1"], editors: ["a1"], consumers: ["a1"], states: ["draft"] },
      },
      validations: {
        v1: { target_artifact: "art1", kind: "approval", executor_type: "agent", executor: "a1", blocking: true },
      },
      workflow: { implement: { steps: [{ type: "validation", validation: "v1" }] } },
    });
    const diags = validationCoverageRule.run(dsl);
    expect(diags.filter((d) => d.message.includes("Blocking validation"))).toHaveLength(0);
  });

  it("passes when blocking validation is referenced in task.validations", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P", can_return_handoffs: ["h", "r"] } },
      artifacts: {
        art1: { type: "doc", owner: "a1", producers: ["a1"], editors: ["a1"], consumers: ["a1"], states: ["draft"] },
      },
      validations: {
        v1: { target_artifact: "art1", kind: "approval", executor_type: "agent", executor: "a1", blocking: true },
      },
      tasks: {
        t1: {
          description: "d", target_agent: "a1", allowed_from_agents: ["a1"],
          workflow: "implement", input_artifacts: [], invocation_handoff: "h", result_handoff: "r",
          validations: ["v1"],
        },
      },
      handoff_types: {
        h: { version: 1, schema: {} },
        r: { version: 1, schema: {} },
      },
    });
    const diags = validationCoverageRule.run(dsl);
    expect(diags.filter((d) => d.message.includes("Blocking validation"))).toHaveLength(0);
  });
});

describe("toolExecutionRule", () => {
  it("detects can_execute_tools ↔ invokable_by mismatch (agent side)", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P", can_execute_tools: ["t1"] }, a2: { role_name: "R2", purpose: "P2" } },
      tools: { t1: { kind: "cli", invokable_by: ["a2"] } },
    });
    const diags = toolExecutionRule.run(dsl);
    expect(diags.some((d) => d.message.includes("invokable_by does not include"))).toBe(true);
  });

  it("skips invokable_by check when invokable_by is empty (deprecated)", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P", can_execute_tools: ["t1"] } },
      tools: { t1: { kind: "cli", invokable_by: [] } },
    });
    const diags = toolExecutionRule.run(dsl);
    expect(diags.some((d) => d.message.includes("invokable_by does not include"))).toBe(false);
  });

  it("detects invokable_by ↔ can_execute_tools mismatch (tool side)", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P", can_execute_tools: [] } },
      tools: { t1: { kind: "cli", invokable_by: ["a1"] } },
    });
    const diags = toolExecutionRule.run(dsl);
    expect(diags.some((d) => d.message.includes("can_execute_tools does not include"))).toBe(true);
  });

  it("detects execution_steps uses_tool not in agent capabilities", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P", can_execute_tools: [] } },
      tasks: {
        t1: {
          description: "d", target_agent: "a1", allowed_from_agents: ["a1"],
          workflow: "implement", input_artifacts: [], invocation_handoff: "h", result_handoff: "r",
          execution_steps: [{ id: "s1", action: "Act", uses_tool: "missing-tool" }],
        },
      },
    });
    const diags = toolExecutionRule.run(dsl);
    expect(diags.some((d) => d.message.includes("missing-tool"))).toBe(true);
  });

  it("passes when tools are bidirectionally consistent", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P", can_execute_tools: ["t1"] } },
      tools: { t1: { kind: "cli", invokable_by: ["a1"] } },
    });
    const diags = toolExecutionRule.run(dsl);
    expect(diags).toHaveLength(0);
  });

  it("detects executor_type=tool validation with no capable agent", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P", can_execute_tools: [] } },
      artifacts: { art1: { type: "code", owner: "a1", producers: ["a1"], editors: ["a1"], consumers: ["a1"], states: ["draft"] } },
      tools: { "lint-tool": { kind: "cli", invokable_by: [] } },
      validations: {
        v1: { target_artifact: "art1", kind: "mechanical", executor_type: "tool", executor: "lint-tool", blocking: true },
      },
    });
    const diags = toolExecutionRule.run(dsl);
    expect(diags.some((d) => d.message.includes("executor_type=tool") && d.message.includes("no agent"))).toBe(true);
  });

  it("passes executor_type=tool check when agent can execute", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P", can_execute_tools: ["lint-tool"] } },
      artifacts: { art1: { type: "code", owner: "a1", producers: ["a1"], editors: ["a1"], consumers: ["a1"], states: ["draft"] } },
      tools: { "lint-tool": { kind: "cli", invokable_by: ["a1"] } },
      validations: {
        v1: { target_artifact: "art1", kind: "mechanical", executor_type: "tool", executor: "lint-tool", blocking: true },
      },
    });
    const diags = toolExecutionRule.run(dsl);
    expect(diags.filter((d) => d.message.includes("executor_type=tool"))).toHaveLength(0);
  });
});


describe("taskAgentBindingRule", () => {
  it("detects allowed_from_agents ↔ can_invoke_agents mismatch", () => {
    const dsl = makeDsl({
      agents: {
        caller: { role_name: "C", purpose: "P", can_invoke_agents: [] },
        target: { role_name: "T", purpose: "P" },
      },
      tasks: {
        t1: {
          description: "d", target_agent: "target", allowed_from_agents: ["caller"],
          workflow: "implement", input_artifacts: [], invocation_handoff: "h", result_handoff: "r",
        },
      },
    });
    const diags = taskAgentBindingRule.run(dsl);
    expect(diags.some((d) => d.severity === "error" && d.message.includes("can_invoke_agents"))).toBe(true);
  });

  it("warns when non-dispatch_only agent has no tasks", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P" } },
    });
    const diags = taskAgentBindingRule.run(dsl);
    expect(diags.some((d) => d.severity === "warning" && d.message.includes("no tasks assigned"))).toBe(true);
  });

  it("skips dispatch_only agents from unassigned check", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P", dispatch_only: true } },
    });
    const diags = taskAgentBindingRule.run(dsl);
    expect(diags.filter((d) => d.message.includes("no tasks assigned"))).toHaveLength(0);
  });

  it("detects execution_steps.produces_artifact not in agent can_write_artifacts", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P", can_write_artifacts: ["other-art"] } },
      artifacts: { art1: { type: "doc", owner: "a1", producers: ["a1"], editors: ["a1"], consumers: ["a1"], states: ["draft"] } },
      tasks: {
        t1: {
          description: "d", target_agent: "a1", allowed_from_agents: ["a1"],
          workflow: "implement", input_artifacts: [], invocation_handoff: "h", result_handoff: "r",
          execution_steps: [{ id: "s1", action: "Act", produces_artifact: "art1" }],
        },
      },
    });
    const diags = taskAgentBindingRule.run(dsl);
    expect(diags.some((d) => d.message.includes("produces_artifact"))).toBe(true);
  });

  it("detects input_artifacts not in target agent can_read_artifacts", () => {
    const dsl = makeDsl({
      agents: {
        a1: { role_name: "R", purpose: "P", can_read_artifacts: ["other-art"] },
      },
      artifacts: { art1: { type: "doc", owner: "a1", producers: ["a1"], editors: ["a1"], consumers: ["a1"], states: ["draft"] } },
      tasks: {
        t1: {
          description: "d", target_agent: "a1", allowed_from_agents: ["a1"],
          workflow: "implement", input_artifacts: ["art1"], invocation_handoff: "h", result_handoff: "r",
        },
      },
    });
    const diags = taskAgentBindingRule.run(dsl);
    expect(diags.some((d) => d.message.includes("input_artifact") && d.message.includes("can_read_artifacts"))).toBe(true);
  });

  it("detects result_handoff not in target agent can_return_handoffs", () => {
    const dsl = makeDsl({
      agents: {
        a1: { role_name: "R", purpose: "P", can_return_handoffs: ["inv"] },
      },
      tasks: {
        t1: {
          description: "d", target_agent: "a1", allowed_from_agents: ["a1"],
          workflow: "implement", input_artifacts: [], invocation_handoff: "inv", result_handoff: "res",
        },
      },
      handoff_types: {
        inv: { version: 1, schema: {} },
        res: { version: 1, schema: {} },
      },
    });
    const diags = taskAgentBindingRule.run(dsl);
    expect(diags.some((d) => d.message.includes("result_handoff") && d.message.includes("can_return_handoffs"))).toBe(true);
  });

  it("detects uses_tool bidirectional mismatch (tool invokable_by missing target)", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P", can_execute_tools: ["t1"], can_return_handoffs: ["h", "r"] }, a2: { role_name: "R2", purpose: "P2" } },
      tools: { t1: { kind: "cli", invokable_by: ["a2"] } },
      tasks: {
        task1: {
          description: "d", target_agent: "a1", allowed_from_agents: ["a1"],
          workflow: "implement", input_artifacts: [], invocation_handoff: "h", result_handoff: "r",
          execution_steps: [{ id: "s1", action: "Act", uses_tool: "t1" }],
        },
      },
      handoff_types: {
        h: { version: 1, schema: {} },
        r: { version: 1, schema: {} },
      },
    });
    const diags = taskAgentBindingRule.run(dsl);
    expect(diags.some((d) => d.message.includes("invokable_by does not include"))).toBe(true);
  });

  it("skips invokable_by check when invokable_by is empty (deprecated)", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P", can_execute_tools: ["t1"], can_return_handoffs: ["h", "r"] } },
      tools: { t1: { kind: "cli", invokable_by: [] } },
      tasks: {
        task1: {
          description: "d", target_agent: "a1", allowed_from_agents: ["a1"],
          workflow: "implement", input_artifacts: [], invocation_handoff: "h", result_handoff: "r",
          execution_steps: [{ id: "s1", action: "Act", uses_tool: "t1" }],
        },
      },
      handoff_types: {
        h: { version: 1, schema: {} },
        r: { version: 1, schema: {} },
      },
    });
    const diags = taskAgentBindingRule.run(dsl);
    expect(diags.some((d) => d.message.includes("invokable_by does not include"))).toBe(false);
  });
});

describe("mergeIntegrityRule", () => {
  it("detects duplicate phases in default_workflow_order", () => {
    const dsl = DslSchema.parse({
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: ["implement", "implement"] },
    });
    const diags = mergeIntegrityRule.run(dsl);
    expect(diags.some((d) => d.message.includes("Duplicate workflow"))).toBe(true);
  });

  it("passes when no duplicates exist", () => {
    const dsl = loadDsl("minimal/agent-contracts.yaml");
    const diags = mergeIntegrityRule.run(dsl);
    expect(diags).toHaveLength(0);
  });
});

describe("validationCoverageRule – required_validations emptiness", () => {
  it("warns when artifact has empty required_validations (non-strict type)", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P" } },
      artifacts: {
        art1: { type: "doc", owner: "a1", producers: ["a1"], editors: ["a1"], consumers: ["a1"], states: ["draft"] },
      },
      validations: {
        v1: { target_artifact: "art1", kind: "approval", executor_type: "agent", executor: "a1", blocking: false },
      },
    });
    const diags = validationCoverageRule.run(dsl);
    const empty = diags.filter((d) => d.message.includes("empty required_validations"));
    expect(empty.length).toBe(1);
    expect(empty[0].severity).toBe("warning");
  });

  it("warns when code artifact has empty required_validations", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P" } },
      artifacts: {
        art1: { type: "code", owner: "a1", producers: ["a1"], editors: ["a1"], consumers: ["a1"], states: ["draft"] },
      },
      validations: {
        v1: { target_artifact: "art1", kind: "mechanical", executor_type: "tool", executor: "t1", blocking: true },
      },
      tools: { t1: { kind: "cli", invokable_by: ["a1"] } },
    });
    const diags = validationCoverageRule.run(dsl);
    const empty = diags.filter((d) => d.message.includes("empty required_validations"));
    expect(empty.length).toBe(1);
    expect(empty[0].severity).toBe("warning");
  });

  it("warns when schema artifact has empty required_validations", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P" } },
      artifacts: {
        art1: { type: "schema", owner: "a1", producers: ["a1"], editors: ["a1"], consumers: ["a1"], states: ["draft"] },
      },
      validations: {
        v1: { target_artifact: "art1", kind: "schema", executor_type: "tool", executor: "t1", blocking: true },
      },
      tools: { t1: { kind: "cli", invokable_by: ["a1"] } },
    });
    const diags = validationCoverageRule.run(dsl);
    const empty = diags.filter((d) => d.message.includes("empty required_validations"));
    expect(empty.length).toBe(1);
    expect(empty[0].severity).toBe("warning");
  });

  it("warns when config artifact has empty required_validations", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P" } },
      artifacts: {
        art1: { type: "config", owner: "a1", producers: ["a1"], editors: ["a1"], consumers: ["a1"], states: ["draft"] },
      },
      validations: {
        v1: { target_artifact: "art1", kind: "mechanical", executor_type: "tool", executor: "t1", blocking: true },
      },
      tools: { t1: { kind: "cli", invokable_by: ["a1"] } },
    });
    const diags = validationCoverageRule.run(dsl);
    const empty = diags.filter((d) => d.message.includes("empty required_validations"));
    expect(empty.length).toBe(1);
    expect(empty[0].severity).toBe("warning");
  });

  it("no emptiness warning when required_validations is populated", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P" } },
      artifacts: {
        art1: {
          type: "code", owner: "a1", producers: ["a1"], editors: ["a1"], consumers: ["a1"], states: ["draft"],
          required_validations: ["v1"],
        },
      },
      validations: {
        v1: { target_artifact: "art1", kind: "mechanical", executor_type: "tool", executor: "t1", blocking: true },
      },
      tools: { t1: { kind: "cli", invokable_by: ["a1"] } },
      workflow: { implement: { steps: [{ type: "validation", validation: "v1" }] } },
    });
    const diags = validationCoverageRule.run(dsl);
    expect(diags.filter((d) => d.message.includes("empty required_validations"))).toHaveLength(0);
  });
});

describe("artifactRequiredValidationWiringRule", () => {
  it("errors when required_validation does not exist", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P" } },
      artifacts: {
        art1: {
          type: "doc", owner: "a1", producers: ["a1"], editors: ["a1"], consumers: ["a1"], states: ["draft"],
          required_validations: ["nonexistent-val"],
        },
      },
    });
    const diags = artifactRequiredValidationWiringRule.run(dsl);
    expect(diags.length).toBe(1);
    expect(diags[0].severity).toBe("error");
    expect(diags[0].message).toContain("does not exist");
  });

  it("errors when required_validation targets a different artifact", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P" } },
      artifacts: {
        art1: {
          type: "doc", owner: "a1", producers: ["a1"], editors: ["a1"], consumers: ["a1"], states: ["draft"],
          required_validations: ["v1"],
        },
        art2: {
          type: "doc", owner: "a1", producers: ["a1"], editors: ["a1"], consumers: ["a1"], states: ["draft"],
        },
      },
      validations: {
        v1: { target_artifact: "art2", kind: "semantic", executor_type: "agent", executor: "a1", blocking: false },
      },
    });
    const diags = artifactRequiredValidationWiringRule.run(dsl);
    const mismatch = diags.filter((d) => d.message.includes("target_artifact"));
    expect(mismatch.length).toBe(1);
    expect(mismatch[0].severity).toBe("error");
  });

  it("warns when required_validation is not referenced in any workflow step or task", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P" } },
      artifacts: {
        art1: {
          type: "doc", owner: "a1", producers: ["a1"], editors: ["a1"], consumers: ["a1"], states: ["draft"],
          required_validations: ["v1"],
        },
      },
      validations: {
        v1: { target_artifact: "art1", kind: "semantic", executor_type: "agent", executor: "a1", blocking: false },
      },
    });
    const diags = artifactRequiredValidationWiringRule.run(dsl);
    const unreferenced = diags.filter((d) => d.message.includes("not referenced"));
    expect(unreferenced.length).toBe(1);
    expect(unreferenced[0].severity).toBe("warning");
  });

  it("passes when required_validation is referenced in a workflow step", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P" } },
      artifacts: {
        art1: {
          type: "doc", owner: "a1", producers: ["a1"], editors: ["a1"], consumers: ["a1"], states: ["draft"],
          required_validations: ["v1"],
        },
      },
      validations: {
        v1: { target_artifact: "art1", kind: "semantic", executor_type: "agent", executor: "a1", blocking: false },
      },
      workflow: { implement: { steps: [{ type: "validation", validation: "v1" }] } },
    });
    const diags = artifactRequiredValidationWiringRule.run(dsl);
    expect(diags).toHaveLength(0);
  });

  it("passes when required_validation is referenced in task.validations", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P", can_return_handoffs: ["h", "r"] } },
      artifacts: {
        art1: {
          type: "doc", owner: "a1", producers: ["a1"], editors: ["a1"], consumers: ["a1"], states: ["draft"],
          required_validations: ["v1"],
        },
      },
      validations: {
        v1: { target_artifact: "art1", kind: "semantic", executor_type: "agent", executor: "a1", blocking: false },
      },
      tasks: {
        t1: {
          description: "d", target_agent: "a1", allowed_from_agents: ["a1"],
          workflow: "implement", input_artifacts: [], invocation_handoff: "h", result_handoff: "r",
          validations: ["v1"],
        },
      },
      handoff_types: { h: { version: 1, schema: {} }, r: { version: 1, schema: {} } },
    });
    const diags = artifactRequiredValidationWiringRule.run(dsl);
    expect(diags).toHaveLength(0);
  });

  it("passes with no diagnostics when required_validations is empty", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P" } },
      artifacts: {
        art1: { type: "doc", owner: "a1", producers: ["a1"], editors: ["a1"], consumers: ["a1"], states: ["draft"] },
      },
    });
    const diags = artifactRequiredValidationWiringRule.run(dsl);
    expect(diags).toHaveLength(0);
  });
});

describe("taskOutputValidationCompletenessRule", () => {
  it("warns when task produces artifact with uncovered required_validations via execution_steps", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P", can_return_handoffs: ["h", "r"] } },
      artifacts: {
        art1: {
          type: "code", owner: "a1", producers: ["a1"], editors: ["a1"], consumers: ["a1"], states: ["draft"],
          required_validations: ["v1", "v2"],
        },
      },
      validations: {
        v1: { target_artifact: "art1", kind: "mechanical", executor_type: "tool", executor: "t1", blocking: true },
        v2: { target_artifact: "art1", kind: "semantic", executor_type: "agent", executor: "a1", blocking: false },
      },
      tools: { t1: { kind: "cli", invokable_by: ["a1"] } },
      tasks: {
        t1: {
          description: "d", target_agent: "a1", allowed_from_agents: ["a1"],
          workflow: "implement", input_artifacts: [], invocation_handoff: "h", result_handoff: "r",
          execution_steps: [{ id: "s1", action: "code", produces_artifact: "art1" }],
          validations: [],
        },
      },
      handoff_types: { h: { version: 1, schema: {} }, r: { version: 1, schema: {} } },
    });
    const diags = taskOutputValidationCompletenessRule.run(dsl);
    expect(diags.length).toBe(1);
    expect(diags[0].severity).toBe("warning");
    expect(diags[0].message).toContain("v1");
    expect(diags[0].message).toContain("v2");
  });

  it("warns when task produces artifact via can_write_artifacts with uncovered validations", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P", can_write_artifacts: ["art1"], can_return_handoffs: ["h", "r"] } },
      artifacts: {
        art1: {
          type: "code", owner: "a1", producers: ["a1"], editors: ["a1"], consumers: ["a1"], states: ["draft"],
          required_validations: ["v1"],
        },
      },
      validations: {
        v1: { target_artifact: "art1", kind: "mechanical", executor_type: "tool", executor: "t1", blocking: true },
      },
      tools: { t1: { kind: "cli", invokable_by: ["a1"] } },
      tasks: {
        t1: {
          description: "d", target_agent: "a1", allowed_from_agents: ["a1"],
          workflow: "implement", input_artifacts: [], invocation_handoff: "h", result_handoff: "r",
          validations: [],
        },
      },
      handoff_types: { h: { version: 1, schema: {} }, r: { version: 1, schema: {} } },
    });
    const diags = taskOutputValidationCompletenessRule.run(dsl);
    expect(diags.length).toBe(1);
    expect(diags[0].message).toContain("v1");
  });

  it("passes when task.validations covers all required_validations", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P", can_write_artifacts: ["art1"], can_return_handoffs: ["h", "r"] } },
      artifacts: {
        art1: {
          type: "code", owner: "a1", producers: ["a1"], editors: ["a1"], consumers: ["a1"], states: ["draft"],
          required_validations: ["v1"],
        },
      },
      validations: {
        v1: { target_artifact: "art1", kind: "mechanical", executor_type: "tool", executor: "t1", blocking: true },
      },
      tools: { t1: { kind: "cli", invokable_by: ["a1"] } },
      tasks: {
        t1: {
          description: "d", target_agent: "a1", allowed_from_agents: ["a1"],
          workflow: "implement", input_artifacts: [], invocation_handoff: "h", result_handoff: "r",
          validations: ["v1"],
        },
      },
      handoff_types: { h: { version: 1, schema: {} }, r: { version: 1, schema: {} } },
    });
    const diags = taskOutputValidationCompletenessRule.run(dsl);
    expect(diags).toHaveLength(0);
  });

  it("passes when artifact has no required_validations", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P", can_write_artifacts: ["art1"], can_return_handoffs: ["h", "r"] } },
      artifacts: {
        art1: { type: "code", owner: "a1", producers: ["a1"], editors: ["a1"], consumers: ["a1"], states: ["draft"] },
      },
      tasks: {
        t1: {
          description: "d", target_agent: "a1", allowed_from_agents: ["a1"],
          workflow: "implement", input_artifacts: [], invocation_handoff: "h", result_handoff: "r",
          validations: [],
        },
      },
      handoff_types: { h: { version: 1, schema: {} }, r: { version: 1, schema: {} } },
    });
    const diags = taskOutputValidationCompletenessRule.run(dsl);
    expect(diags).toHaveLength(0);
  });

  it("warns with partial coverage – only some required_validations are missing", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P", can_return_handoffs: ["h", "r"] } },
      artifacts: {
        art1: {
          type: "code", owner: "a1", producers: ["a1"], editors: ["a1"], consumers: ["a1"], states: ["draft"],
          required_validations: ["v1", "v2"],
        },
      },
      validations: {
        v1: { target_artifact: "art1", kind: "mechanical", executor_type: "tool", executor: "t1", blocking: true },
        v2: { target_artifact: "art1", kind: "semantic", executor_type: "agent", executor: "a1", blocking: false },
      },
      tools: { t1: { kind: "cli", invokable_by: ["a1"] } },
      tasks: {
        t1: {
          description: "d", target_agent: "a1", allowed_from_agents: ["a1"],
          workflow: "implement", input_artifacts: [], invocation_handoff: "h", result_handoff: "r",
          execution_steps: [{ id: "s1", action: "code", produces_artifact: "art1" }],
          validations: ["v1"],
        },
      },
      handoff_types: { h: { version: 1, schema: {} }, r: { version: 1, schema: {} } },
    });
    const diags = taskOutputValidationCompletenessRule.run(dsl);
    expect(diags.length).toBe(1);
    expect(diags[0].message).toContain("v2");
    expect(diags[0].message).not.toContain("v1,");
  });
});

describe("deprecatedOwnershipFieldsRule", () => {
  it("warns when artifact uses deprecated ownership fields", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P" } },
      artifacts: {
        art1: {
          type: "code",
          owner: "a1",
          producers: ["a1"],
          editors: ["a1"],
          consumers: ["a1"],
          states: ["draft"],
        },
      },
    });
    const diags = deprecatedOwnershipFieldsRule.run(dsl);
    expect(diags.length).toBe(4);
    expect(diags.every((d) => d.ruleId === "deprecated-ownership-fields")).toBe(true);
    expect(diags.every((d) => d.severity === "warning")).toBe(true);
    expect(diags[0].message).toContain("artifact_bindings + artifact_slots");
  });

  it("warns when agent uses deprecated permission fields", () => {
    const dsl = makeDsl({
      agents: {
        a1: {
          role_name: "R",
          purpose: "P",
          own_artifacts: ["art1"],
          can_read_artifacts: ["art1"],
          can_write_artifacts: ["art1"],
        },
      },
      artifacts: {
        art1: { type: "code", states: ["draft"] },
      },
    });
    const diags = deprecatedOwnershipFieldsRule.run(dsl);
    expect(diags.length).toBe(3);
    expect(diags.every((d) => d.ruleId === "deprecated-ownership-fields")).toBe(true);
    expect(diags[0].message).toContain("artifact_bindings + artifact_slots");
  });

  it("passes when deprecated fields are empty", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P" } },
      artifacts: {
        art1: { type: "code", states: ["draft"] },
      },
    });
    const diags = deprecatedOwnershipFieldsRule.run(dsl);
    expect(diags).toHaveLength(0);
  });
});

describe("memoryConsistencyRule", () => {
  it("warns when resumable is true but emits_memory_ref is not declared", () => {
    const dsl = makeDsl({
      agents: {
        "test-agent": {
          role_name: "Test",
          purpose: "Test",
          memory: { resumable: true },
        },
      },
    });
    const diags = memoryConsistencyRule.run(dsl);
    expect(diags).toHaveLength(1);
    expect(diags[0].ruleId).toBe("memory-consistency");
    expect(diags[0].severity).toBe("warning");
    expect(diags[0].path).toBe("agents.test-agent.memory");
    expect(diags[0].message).toContain("emits_memory_ref");
  });

  it("errors when ref_required is true but resumable is not true", () => {
    const dsl = makeDsl({
      agents: {
        "test-agent": {
          role_name: "Test",
          purpose: "Test",
          memory: { ref_required: true },
        },
      },
    });
    const diags = memoryConsistencyRule.run(dsl);
    expect(diags).toHaveLength(1);
    expect(diags[0].ruleId).toBe("memory-consistency");
    expect(diags[0].severity).toBe("error");
    expect(diags[0].path).toBe("agents.test-agent.memory");
    expect(diags[0].message).toContain("ref_required");
  });

  it("passes when memory config is consistent", () => {
    const dsl = makeDsl({
      agents: {
        "test-agent": {
          role_name: "Test",
          purpose: "Test",
          memory: {
            resumable: true,
            ref_required: true,
            emits_memory_ref: true,
          },
        },
      },
    });
    const diags = memoryConsistencyRule.run(dsl);
    expect(diags).toHaveLength(0);
  });
});

describe("lint() integration", () => {
  it("runs all builtin rules on full fixture", () => {
    const dsl = loadDsl("full/agent-contracts.yaml");
    const diags = lint(dsl);
    expect(Array.isArray(diags)).toBe(true);
    for (const d of diags) {
      expect(d.ruleId).toBeDefined();
      expect(d.severity).toBeDefined();
      expect(d.message).toBeDefined();
    }
  });

  it("aggregates diagnostics from multiple rules", () => {
    const dsl = makeDsl({
      agents: {
        a1: { role_name: "R", purpose: "P", can_execute_tools: ["t1"] },
      },
      tools: { t1: { kind: "cli", invokable_by: [] } },
      artifacts: {
        art1: { type: "code", owner: "a1", producers: ["a1"], editors: ["a1"], consumers: ["a1"], states: [] },
      },
    });
    const diags = lint(dsl);
    const ruleIds = new Set(diags.map((d) => d.ruleId));
    expect(ruleIds.size).toBeGreaterThanOrEqual(2);
  });
});
