import { describe, it, expect } from "vitest";
import { DslSchema, type Dsl } from "../../src/schema/index.js";
import {
  guardrailPolicyActionStateUndefinedRule,
  systemStatesUnusedRule,
} from "../../src/linter/rules/guardrail-policy-action-state.js";

function makeDsl(partial: Partial<Record<string, unknown>>): Dsl {
  return DslSchema.parse({
    version: 1,
    system: { id: "s", name: "S", default_workflow_order: ["implement"] },
    ...partial,
  });
}

describe("guardrailPolicyActionStateUndefinedRule", () => {
  it("returns no diagnostics when all when keys are in system.states", () => {
    const dsl = makeDsl({
      system: {
        id: "s",
        name: "S",
        default_workflow_order: ["implement"],
        states: ["idle", "maintenance"],
      },
      guardrails: { g1: { description: "d", scope: {} } },
      guardrail_policies: {
        p1: {
          rules: [
            {
              guardrail: "g1",
              severity: "critical",
              action: { default: "block", when: { maintenance: "shadow" } },
            },
          ],
        },
      },
    });
    expect(guardrailPolicyActionStateUndefinedRule.run(dsl)).toHaveLength(0);
  });

  it("returns error when a when key is not in system.states", () => {
    const dsl = makeDsl({
      system: {
        id: "s",
        name: "S",
        default_workflow_order: ["implement"],
        states: ["idle"],
      },
      guardrails: { g1: { description: "d", scope: {} } },
      guardrail_policies: {
        p1: {
          rules: [
            {
              guardrail: "g1",
              severity: "critical",
              action: { default: "block", when: { maintenance: "shadow" } },
            },
          ],
        },
      },
    });
    const diags = guardrailPolicyActionStateUndefinedRule.run(dsl);
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe("error");
    expect(diags[0].ruleId).toBe("guardrail-policy-action-state-undefined");
    expect(diags[0].message).toContain("maintenance");
  });

  it("returns no diagnostics when action is a simple string", () => {
    const dsl = makeDsl({
      system: {
        id: "s",
        name: "S",
        default_workflow_order: ["implement"],
        states: ["idle"],
      },
      guardrails: { g1: { description: "d", scope: {} } },
      guardrail_policies: {
        p1: {
          rules: [{ guardrail: "g1", severity: "critical", action: "block" }],
        },
      },
    });
    expect(guardrailPolicyActionStateUndefinedRule.run(dsl)).toHaveLength(0);
  });

  it("returns no diagnostics when system.states is empty and no when is used", () => {
    const dsl = makeDsl({
      guardrails: { g1: { description: "d", scope: {} } },
      guardrail_policies: {
        p1: {
          rules: [{ guardrail: "g1", severity: "critical", action: "block" }],
        },
      },
    });
    expect(guardrailPolicyActionStateUndefinedRule.run(dsl)).toHaveLength(0);
  });

  it("returns error when system.states is empty but action.when references a state", () => {
    const dsl = makeDsl({
      guardrails: { g1: { description: "d", scope: {} } },
      guardrail_policies: {
        p1: {
          rules: [
            {
              guardrail: "g1",
              severity: "critical",
              action: { default: "block", when: { maintenance: "shadow" } },
            },
          ],
        },
      },
    });
    const diags = guardrailPolicyActionStateUndefinedRule.run(dsl);
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe("error");
    expect(diags[0].message).toContain("maintenance");
  });
});

describe("systemStatesUnusedRule", () => {
  it("returns no diagnostics when all states are referenced", () => {
    const dsl = makeDsl({
      system: {
        id: "s",
        name: "S",
        default_workflow_order: ["implement"],
        states: ["idle", "maintenance"],
      },
      guardrails: { g1: { description: "d", scope: {} } },
      guardrail_policies: {
        p1: {
          rules: [
            {
              guardrail: "g1",
              severity: "critical",
              action: {
                default: "block",
                when: { idle: "warn", maintenance: "shadow" },
              },
            },
          ],
        },
      },
    });
    expect(systemStatesUnusedRule.run(dsl)).toHaveLength(0);
  });

  it("returns info when a state is declared but never used in any policy when", () => {
    const dsl = makeDsl({
      system: {
        id: "s",
        name: "S",
        default_workflow_order: ["implement"],
        states: ["idle", "orphan"],
      },
      guardrails: { g1: { description: "d", scope: {} } },
      guardrail_policies: {
        p1: {
          rules: [
            {
              guardrail: "g1",
              severity: "critical",
              action: { default: "block", when: { idle: "warn" } },
            },
          ],
        },
      },
    });
    const diags = systemStatesUnusedRule.run(dsl);
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe("info");
    expect(diags[0].ruleId).toBe("system-states-unused");
    expect(diags[0].message).toContain("orphan");
  });

  it("returns no diagnostics when system.states is empty", () => {
    const dsl = makeDsl({
      guardrails: { g1: { description: "d", scope: {} } },
      guardrail_policies: {
        p1: {
          rules: [
            {
              guardrail: "g1",
              severity: "critical",
              action: { default: "block", when: { maintenance: "shadow" } },
            },
          ],
        },
      },
    });
    expect(systemStatesUnusedRule.run(dsl)).toHaveLength(0);
  });

  it("returns info for all states when all policy rules use simple string action", () => {
    const dsl = makeDsl({
      system: {
        id: "s",
        name: "S",
        default_workflow_order: ["implement"],
        states: ["idle", "maintenance"],
      },
      guardrails: { g1: { description: "d", scope: {} } },
      guardrail_policies: {
        p1: {
          rules: [{ guardrail: "g1", severity: "critical", action: "block" }],
        },
      },
    });
    const diags = systemStatesUnusedRule.run(dsl);
    expect(diags).toHaveLength(2);
    expect(diags.every(d => d.severity === "info")).toBe(true);
  });
});
