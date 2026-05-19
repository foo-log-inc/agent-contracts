import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { parse as parseYaml } from "yaml";
import { describe, it, expect } from "vitest";
import { DslSchema, type Dsl } from "../../src/schema/index.js";
import { score } from "../../src/scorer/scorer.js";
import type { ScoreResult } from "../../src/scorer/types.js";

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

function dim(result: ScoreResult, id: string) {
  return result.dimensions.find((d) => d.id === id)!;
}

describe("score()", () => {
  it("returns overall score between 0 and 100", () => {
    const dsl = makeDsl({});
    const result = score(dsl);
    expect(result.overall).toBeGreaterThanOrEqual(0);
    expect(result.overall).toBeLessThanOrEqual(100);
  });

  it("returns 7 dimensions", () => {
    const dsl = makeDsl({});
    const result = score(dsl);
    expect(result.dimensions).toHaveLength(7);
  });

  it("returns 100 for an empty DSL (no entities = nothing to check)", () => {
    const dsl = makeDsl({});
    const result = score(dsl);
    expect(result.overall).toBe(100);
  });
});

describe("artifact-validation-coverage", () => {
  it("scores 0% when all artifacts have empty required_validations", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P" } },
      artifacts: {
        art1: { type: "code", owner: "a1", producers: ["a1"], editors: ["a1"], consumers: ["a1"], states: ["draft"] },
        art2: { type: "doc", owner: "a1", producers: ["a1"], editors: ["a1"], consumers: ["a1"], states: ["draft"] },
      },
    });
    const d = dim(score(dsl), "artifact-validation-coverage");
    expect(d.percent).toBe(0);
    expect(d.score).toBe(0);
    expect(d.total).toBe(2);
    expect(d.recommendations.length).toBeGreaterThan(0);
    expect(d.recommendations[0]).toContain("art1");
  });

  it("scores 100% when all artifacts have required_validations", () => {
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
    });
    const d = dim(score(dsl), "artifact-validation-coverage");
    expect(d.percent).toBe(100);
    expect(d.recommendations).toHaveLength(0);
  });

  it("scores 50% with mixed coverage", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P" } },
      artifacts: {
        art1: {
          type: "code", owner: "a1", producers: ["a1"], editors: ["a1"], consumers: ["a1"], states: ["draft"],
          required_validations: ["v1"],
        },
        art2: { type: "doc", owner: "a1", producers: ["a1"], editors: ["a1"], consumers: ["a1"], states: ["draft"] },
      },
      validations: {
        v1: { target_artifact: "art1", kind: "mechanical", executor_type: "tool", executor: "t1", blocking: true },
      },
    });
    const d = dim(score(dsl), "artifact-validation-coverage");
    expect(d.percent).toBe(50);
    expect(d.score).toBe(1);
    expect(d.total).toBe(2);
  });
});

describe("task-validation-coverage", () => {
  it("scores 0% when no tasks have validations", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P", can_return_handoffs: ["h", "r"] } },
      tasks: {
        t1: {
          description: "d", target_agent: "a1", allowed_from_agents: ["a1"],
          workflow: "implement", input_artifacts: [], invocation_handoff: "h", result_handoff: "r",
        },
      },
      handoff_types: { h: { version: 1, schema: {} }, r: { version: 1, schema: {} } },
    });
    const d = dim(score(dsl), "task-validation-coverage");
    expect(d.percent).toBe(0);
    expect(d.recommendations[0]).toContain("t1");
  });

  it("scores 100% when all tasks have validations", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P", can_return_handoffs: ["h", "r"] } },
      artifacts: { art1: { type: "code", owner: "a1", producers: ["a1"], editors: ["a1"], consumers: ["a1"], states: ["draft"] } },
      validations: {
        v1: { target_artifact: "art1", kind: "mechanical", executor_type: "tool", executor: "t1", blocking: true },
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
    const d = dim(score(dsl), "task-validation-coverage");
    expect(d.percent).toBe(100);
    expect(d.recommendations).toHaveLength(0);
  });
});

describe("guardrail-policy-coverage", () => {
  it("scores 0% when guardrails are not covered by policies", () => {
    const dsl = makeDsl({
      guardrails: {
        g1: { description: "d", scope: {} },
      },
    });
    const d = dim(score(dsl), "guardrail-policy-coverage");
    expect(d.percent).toBe(0);
    expect(d.recommendations[0]).toContain("g1");
  });

  it("scores 100% when all guardrails have policy rules", () => {
    const dsl = makeDsl({
      guardrails: {
        g1: { description: "d", scope: {} },
      },
      guardrail_policies: {
        p1: { rules: [{ guardrail: "g1", severity: "warning", action: "warn" }] },
      },
    });
    const d = dim(score(dsl), "guardrail-policy-coverage");
    expect(d.percent).toBe(100);
  });
});

describe("workflow-validation-integration", () => {
  it("scores 0% when blocking validations are not wired", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P" } },
      artifacts: { art1: { type: "code", owner: "a1", producers: ["a1"], editors: ["a1"], consumers: ["a1"], states: ["draft"] } },
      validations: {
        v1: { target_artifact: "art1", kind: "mechanical", executor_type: "tool", executor: "t1", blocking: true },
      },
    });
    const d = dim(score(dsl), "workflow-validation-integration");
    expect(d.percent).toBe(0);
    expect(d.recommendations[0]).toContain("v1");
  });

  it("scores 100% when all blocking validations are referenced in tasks", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P", can_return_handoffs: ["h", "r"] } },
      artifacts: { art1: { type: "code", owner: "a1", producers: ["a1"], editors: ["a1"], consumers: ["a1"], states: ["draft"] } },
      validations: {
        v1: { target_artifact: "art1", kind: "mechanical", executor_type: "tool", executor: "t1", blocking: true },
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
    const d = dim(score(dsl), "workflow-validation-integration");
    expect(d.percent).toBe(100);
  });

  it("scores 100% when all blocking validations are referenced in workflow steps", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P" } },
      artifacts: { art1: { type: "code", owner: "a1", producers: ["a1"], editors: ["a1"], consumers: ["a1"], states: ["draft"] } },
      validations: {
        v1: { target_artifact: "art1", kind: "mechanical", executor_type: "tool", executor: "t1", blocking: true },
      },
      workflow: { implement: { steps: [{ type: "validation", validation: "v1" }] } },
    });
    const d = dim(score(dsl), "workflow-validation-integration");
    expect(d.percent).toBe(100);
  });

  it("ignores non-blocking validations", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P" } },
      artifacts: { art1: { type: "code", owner: "a1", producers: ["a1"], editors: ["a1"], consumers: ["a1"], states: ["draft"] } },
      validations: {
        v1: { target_artifact: "art1", kind: "semantic", executor_type: "agent", executor: "a1", blocking: false },
      },
    });
    const d = dim(score(dsl), "workflow-validation-integration");
    expect(d.percent).toBe(100);
    expect(d.total).toBe(0);
  });
});

describe("schema-completeness", () => {
  it("scores high when optional fields are filled", () => {
    const dsl = makeDsl({
      agents: {
        a1: {
          role_name: "R", purpose: "P",
          responsibilities: ["resp1"],
          constraints: ["c1"],
          rules: [{ id: "r1", description: "d", severity: "mandatory" }],
        },
      },
    });
    const d = dim(score(dsl), "schema-completeness");
    expect(d.percent).toBe(100);
  });

  it("scores lower when optional fields are empty", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P" } },
    });
    const d = dim(score(dsl), "schema-completeness");
    expect(d.percent).toBeLessThan(100);
  });
});


describe("guardrail-scope-resolution", () => {
  it("scores 100% when all scope entries resolve", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P" } },
      tools: { t1: { kind: "cli", invokable_by: ["a1"] } },
      guardrails: {
        g1: { description: "d", scope: { agents: ["a1"], tools: ["t1"] } },
      },
    });
    const d = dim(score(dsl), "guardrail-scope-resolution");
    expect(d.percent).toBe(100);
  });

  it("detects unresolved scope references", () => {
    const dsl = makeDsl({
      guardrails: {
        g1: { description: "d", scope: { agents: ["nonexistent"] } },
      },
    });
    const d = dim(score(dsl), "guardrail-scope-resolution");
    expect(d.percent).toBe(0);
    expect(d.recommendations[0]).toContain("nonexistent");
  });

  it("scores 100% when no scope entries exist", () => {
    const dsl = makeDsl({
      guardrails: {
        g1: { description: "d", scope: {} },
      },
    });
    const d = dim(score(dsl), "guardrail-scope-resolution");
    expect(d.percent).toBe(100);
  });
});

describe("overall score weighting", () => {
  it("weighted average reflects high-weight dimension failures", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P", can_return_handoffs: ["h", "r"] } },
      artifacts: {
        art1: { type: "code", owner: "a1", producers: ["a1"], editors: ["a1"], consumers: ["a1"], states: ["draft"] },
      },
      validations: {
        v1: { target_artifact: "art1", kind: "mechanical", executor_type: "tool", executor: "t1", blocking: true },
      },
      tasks: {
        t1: {
          description: "d", target_agent: "a1", allowed_from_agents: ["a1"],
          workflow: "implement", input_artifacts: [], invocation_handoff: "h", result_handoff: "r",
        },
      },
      handoff_types: { h: { version: 1, schema: {} }, r: { version: 1, schema: {} } },
    });
    const result = score(dsl);
    expect(result.overall).toBeLessThan(100);
    expect(result.overall).toBeGreaterThan(0);
  });
});

describe("score on full fixture", () => {
  it("produces a valid score for the full fixture", () => {
    const dsl = loadDsl("full/agent-contracts.yaml");
    const result = score(dsl);
    expect(result.overall).toBeGreaterThanOrEqual(0);
    expect(result.overall).toBeLessThanOrEqual(100);
    expect(result.dimensions).toHaveLength(7);
    for (const d of result.dimensions) {
      expect(d.percent).toBeGreaterThanOrEqual(0);
      expect(d.percent).toBeLessThanOrEqual(100);
      expect(d.id).toBeTruthy();
      expect(d.label).toBeTruthy();
    }
  });
});
