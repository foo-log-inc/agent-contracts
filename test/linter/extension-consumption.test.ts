import { describe, it, expect } from "vitest";
import { DslSchema, type Dsl } from "../../src/schema/index.js";
import {
  extensionDeclaredButUnusedRule,
  extensionScopeMismatchRule,
  extensionUndeclaredUsageRule,
} from "../../src/linter/rules/extension-consumption.js";

function makeDsl(partial: Partial<Record<string, unknown>>): Dsl {
  return DslSchema.parse({
    version: 1,
    system: { id: "s", name: "S", default_workflow_order: ["implement"] },
    ...partial,
  });
}

describe("extensionDeclaredButUnusedRule", () => {
  it("warns when a declared extension is never used", () => {
    const dsl = makeDsl({
      extensions: {
        "x-meta": { type: "string", required: false },
      },
      agents: { a1: { role_name: "R", purpose: "P" } },
    });
    const diags = extensionDeclaredButUnusedRule.run(dsl);
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe("warning");
    expect(diags[0].path).toBe("extensions.x-meta");
    expect(diags[0].message).toContain("never used");
  });

  it("no warning when declared extension is used on an agent", () => {
    const dsl = makeDsl({
      extensions: {
        "x-notes": { type: "string", required: false },
      },
      agents: {
        a1: { role_name: "R", purpose: "P", "x-notes": "some note" },
      },
    });
    const diags = extensionDeclaredButUnusedRule.run(dsl);
    expect(diags).toHaveLength(0);
  });

  it("no warning when declared extension is used on a task", () => {
    const dsl = makeDsl({
      extensions: {
        "x-task-info": { type: "string", required: false },
      },
      tasks: {
        t1: {
          description: "d", target_agent: "a1",
          allowed_from_agents: ["a1"], workflow: "implement",
          input_artifacts: [], invocation_handoff: "h", result_handoff: "r",
          "x-task-info": "info",
        },
      },
    });
    const diags = extensionDeclaredButUnusedRule.run(dsl);
    expect(diags).toHaveLength(0);
  });

  it("no warning when declared extension is used on system", () => {
    const dsl = makeDsl({
      extensions: {
        "x-sys": { type: "object", required: false },
      },
      system: {
        id: "s", name: "S", default_workflow_order: ["implement"],
        "x-sys": { tier: "prod" },
      },
    });
    const diags = extensionDeclaredButUnusedRule.run(dsl);
    expect(diags).toHaveLength(0);
  });

  it("warns for multiple declared-but-unused extensions", () => {
    const dsl = makeDsl({
      extensions: {
        "x-a": { type: "string", required: false },
        "x-b": { type: "string", required: false },
        "x-c": { type: "string", required: false },
      },
      agents: {
        a1: { role_name: "R", purpose: "P", "x-a": "used" },
      },
    });
    const diags = extensionDeclaredButUnusedRule.run(dsl);
    expect(diags).toHaveLength(2);
    const paths = diags.map((d) => d.path).sort();
    expect(paths).toEqual(["extensions.x-b", "extensions.x-c"]);
  });

  it("returns empty when no extensions declared", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P", "x-custom": "val" } },
    });
    const diags = extensionDeclaredButUnusedRule.run(dsl);
    expect(diags).toHaveLength(0);
  });

  it("detects usage on artifacts", () => {
    const dsl = makeDsl({
      extensions: {
        "x-owner-team": { type: "string", required: false },
      },
      agents: { a1: { role_name: "R", purpose: "P" } },
      artifacts: {
        art1: {
          type: "doc", owner: "a1", producers: ["a1"], editors: ["a1"],
          consumers: ["a1"], states: ["draft"],
          "x-owner-team": "platform",
        },
      },
    });
    const diags = extensionDeclaredButUnusedRule.run(dsl);
    expect(diags).toHaveLength(0);
  });

  it("detects usage on tools", () => {
    const dsl = makeDsl({
      extensions: {
        "x-rate-limit": { type: "string", required: false },
      },
      tools: {
        t1: { kind: "cli", invokable_by: [], "x-rate-limit": "low" },
      },
    });
    const diags = extensionDeclaredButUnusedRule.run(dsl);
    expect(diags).toHaveLength(0);
  });

  it("detects usage on workflows", () => {
    const dsl = makeDsl({
      extensions: {
        "x-wf-meta": { type: "object", required: false },
      },
      workflow: {
        implement: {
          steps: [], "x-wf-meta": { important: true },
        },
      },
    });
    const diags = extensionDeclaredButUnusedRule.run(dsl);
    expect(diags).toHaveLength(0);
  });

  it("detects usage on policies", () => {
    const dsl = makeDsl({
      extensions: {
        "x-policy-meta": { type: "object", required: false },
      },
      policies: {
        p1: {
          when: { artifact_type: "code" },
          "x-policy-meta": { severity: "high" },
        },
      },
    });
    const diags = extensionDeclaredButUnusedRule.run(dsl);
    expect(diags).toHaveLength(0);
  });

  it("detects usage on validations", () => {
    const dsl = makeDsl({
      extensions: {
        "x-val-meta": { type: "object", required: false },
      },
      agents: { a1: { role_name: "R", purpose: "P" } },
      validations: {
        v1: {
          target_artifact: "art1", kind: "semantic",
          executor_type: "agent", executor: "a1", blocking: true,
          "x-val-meta": { depth: "full" },
        },
      },
    });
    const diags = extensionDeclaredButUnusedRule.run(dsl);
    expect(diags).toHaveLength(0);
  });

  it("detects usage on handoff_types", () => {
    const dsl = makeDsl({
      extensions: {
        "x-ht-meta": { type: "object", required: false },
      },
      handoff_types: {
        h1: { version: 1, schema: {}, "x-ht-meta": { stable: true } },
      },
    });
    const diags = extensionDeclaredButUnusedRule.run(dsl);
    expect(diags).toHaveLength(0);
  });

  it("detects usage on guardrails", () => {
    const dsl = makeDsl({
      extensions: {
        "x-gr-meta": { type: "object", required: false },
      },
      guardrails: {
        g1: { description: "G", scope: {}, tags: [], "x-gr-meta": {} },
      },
    });
    const diags = extensionDeclaredButUnusedRule.run(dsl);
    expect(diags).toHaveLength(0);
  });
});

describe("extensionScopeMismatchRule", () => {
  it("warns when extension used outside declared scope", () => {
    const dsl = makeDsl({
      extensions: {
        "x-agent-only": { type: "string", required: false, scope: ["agent"] },
      },
      agents: { a1: { role_name: "R", purpose: "P" } },
      tasks: {
        t1: {
          description: "d", target_agent: "a1",
          allowed_from_agents: ["a1"], workflow: "implement",
          input_artifacts: [], invocation_handoff: "h", result_handoff: "r",
          "x-agent-only": "misplaced",
        },
      },
    });
    const diags = extensionScopeMismatchRule.run(dsl);
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe("warning");
    expect(diags[0].path).toBe("tasks.t1.x-agent-only");
    expect(diags[0].message).toContain("task");
    expect(diags[0].message).toContain("agent");
  });

  it("no warning when extension used within declared scope", () => {
    const dsl = makeDsl({
      extensions: {
        "x-agent-only": { type: "string", required: false, scope: ["agent"] },
      },
      agents: {
        a1: { role_name: "R", purpose: "P", "x-agent-only": "correct" },
      },
    });
    const diags = extensionScopeMismatchRule.run(dsl);
    expect(diags).toHaveLength(0);
  });

  it("no warning when extension has no declared scope", () => {
    const dsl = makeDsl({
      extensions: {
        "x-anywhere": { type: "string", required: false },
      },
      agents: {
        a1: { role_name: "R", purpose: "P", "x-anywhere": "ok" },
      },
      tasks: {
        t1: {
          description: "d", target_agent: "a1",
          allowed_from_agents: ["a1"], workflow: "implement",
          input_artifacts: [], invocation_handoff: "h", result_handoff: "r",
          "x-anywhere": "ok",
        },
      },
    });
    const diags = extensionScopeMismatchRule.run(dsl);
    expect(diags).toHaveLength(0);
  });

  it("no warning when extension has empty scope array", () => {
    const dsl = makeDsl({
      extensions: {
        "x-flex": { type: "string", required: false, scope: [] },
      },
      agents: {
        a1: { role_name: "R", purpose: "P", "x-flex": "ok" },
      },
    });
    const diags = extensionScopeMismatchRule.run(dsl);
    expect(diags).toHaveLength(0);
  });

  it("detects multiple scope mismatches", () => {
    const dsl = makeDsl({
      extensions: {
        "x-tool-only": { type: "string", required: false, scope: ["tool"] },
      },
      agents: {
        a1: { role_name: "R", purpose: "P", "x-tool-only": "bad" },
      },
      tasks: {
        t1: {
          description: "d", target_agent: "a1",
          allowed_from_agents: ["a1"], workflow: "implement",
          input_artifacts: [], invocation_handoff: "h", result_handoff: "r",
          "x-tool-only": "bad",
        },
      },
    });
    const diags = extensionScopeMismatchRule.run(dsl);
    expect(diags).toHaveLength(2);
  });

  it("returns empty when no extensions declared", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P" } },
    });
    const diags = extensionScopeMismatchRule.run(dsl);
    expect(diags).toHaveLength(0);
  });
});

describe("extensionUndeclaredUsageRule", () => {
  it("reports info when x-* used but not declared (with extensions section present)", () => {
    const dsl = makeDsl({
      extensions: {
        "x-declared": { type: "string", required: false },
      },
      agents: {
        a1: { role_name: "R", purpose: "P", "x-declared": "ok", "x-undeclared": "hmm" },
      },
    });
    const diags = extensionUndeclaredUsageRule.run(dsl);
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe("info");
    expect(diags[0].path).toBe("agents.a1.x-undeclared");
    expect(diags[0].message).toContain("not declared");
  });

  it("returns empty when all x-* usages are declared", () => {
    const dsl = makeDsl({
      extensions: {
        "x-meta": { type: "string", required: false },
      },
      agents: {
        a1: { role_name: "R", purpose: "P", "x-meta": "ok" },
      },
    });
    const diags = extensionUndeclaredUsageRule.run(dsl);
    expect(diags).toHaveLength(0);
  });

  it("returns empty when extensions section is empty (no declarations to compare against)", () => {
    const dsl = makeDsl({
      agents: {
        a1: { role_name: "R", purpose: "P", "x-custom": "val" },
      },
    });
    const diags = extensionUndeclaredUsageRule.run(dsl);
    expect(diags).toHaveLength(0);
  });

  it("reports multiple undeclared usages across entities", () => {
    const dsl = makeDsl({
      extensions: {
        "x-known": { type: "string", required: false },
      },
      agents: {
        a1: { role_name: "R", purpose: "P", "x-unknown-a": "a" },
        a2: { role_name: "R2", purpose: "P2", "x-unknown-b": "b" },
      },
    });
    const diags = extensionUndeclaredUsageRule.run(dsl);
    expect(diags).toHaveLength(2);
    const paths = diags.map((d) => d.path).sort();
    expect(paths).toEqual(["agents.a1.x-unknown-a", "agents.a2.x-unknown-b"]);
  });
});
