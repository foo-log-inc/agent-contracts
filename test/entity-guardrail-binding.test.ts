import { describe, it, expect } from "vitest";
import { DslSchema, type Dsl } from "../src/schema/index.js";
import { checkReferences } from "../src/validator/reference-resolver.js";
import { lint } from "../src/linter/linter.js";
import {
  entityGuardrailUndefinedRule,
  entityNoGuardrailsRule,
  guardrailOrphanedRule,
} from "../src/linter/rules/entity-guardrail-binding.js";
import { score } from "../src/scorer/scorer.js";
import {
  resolveEffectiveGuardrails,
  buildPerAgentContext,
  buildTaskContext,
  buildToolContext,
  buildArtifactContext,
} from "../src/renderer/context.js";

function makeDsl(partial: Partial<Record<string, unknown>>): Dsl {
  return DslSchema.parse({
    version: 1,
    system: { id: "s", name: "S", default_workflow_order: ["implement"] },
    ...partial,
  });
}

// -- Schema acceptance --

describe("entity guardrails schema field", () => {
  it("accepts optional guardrails on agents", () => {
    const dsl = makeDsl({
      agents: {
        a1: { role_name: "R", purpose: "P", guardrails: ["g1"] },
      },
      guardrails: { g1: { description: "d", scope: {} } },
    });
    expect(dsl.agents.a1.guardrails).toEqual(["g1"]);
  });

  it("accepts optional guardrails on tasks", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P", can_return_handoffs: ["h", "r"] } },
      tasks: {
        t1: {
          description: "d", target_agent: "a1", allowed_from_agents: ["a1"],
          workflow: "implement", input_artifacts: [], invocation_handoff: "h", result_handoff: "r",
          guardrails: ["g1"],
        },
      },
      handoff_types: { h: { version: 1, schema: {} }, r: { version: 1, schema: {} } },
      guardrails: { g1: { description: "d", scope: {} } },
    });
    expect(dsl.tasks.t1.guardrails).toEqual(["g1"]);
  });

  it("accepts optional guardrails on tools", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P" } },
      tools: { t1: { kind: "cli", invokable_by: ["a1"], guardrails: ["g1"] } },
      guardrails: { g1: { description: "d", scope: {} } },
    });
    expect(dsl.tools.t1.guardrails).toEqual(["g1"]);
  });

  it("accepts optional guardrails on artifacts", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P" } },
      artifacts: {
        art1: {
          type: "code", owner: "a1", producers: ["a1"], editors: ["a1"],
          consumers: ["a1"], states: ["draft"], guardrails: ["g1"],
        },
      },
      guardrails: { g1: { description: "d", scope: {} } },
    });
    expect(dsl.artifacts.art1.guardrails).toEqual(["g1"]);
  });

  it("defaults to undefined when guardrails not provided", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P" } },
    });
    expect(dsl.agents.a1.guardrails).toBeUndefined();
  });
});

// -- Bidirectional resolution --

describe("resolveEffectiveGuardrails", () => {
  it("returns entity-side guardrails", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P", guardrails: ["g1"] } },
      guardrails: { g1: { description: "d", scope: {} } },
    });
    const result = resolveEffectiveGuardrails(dsl, "agents", "a1");
    expect(result).toHaveLength(1);
    expect(result[0].guardrail_id).toBe("g1");
    expect(result[0].source).toBe("entity");
  });

  it("returns scope-side guardrails", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P" } },
      guardrails: { g1: { description: "d", scope: { agents: ["a1"] } } },
    });
    const result = resolveEffectiveGuardrails(dsl, "agents", "a1");
    expect(result).toHaveLength(1);
    expect(result[0].guardrail_id).toBe("g1");
    expect(result[0].source).toBe("scope");
  });

  it("returns both-side guardrails with source=both", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P", guardrails: ["g1"] } },
      guardrails: { g1: { description: "d", scope: { agents: ["a1"] } } },
    });
    const result = resolveEffectiveGuardrails(dsl, "agents", "a1");
    expect(result).toHaveLength(1);
    expect(result[0].guardrail_id).toBe("g1");
    expect(result[0].source).toBe("both");
  });

  it("deduplicates union of entity-side and scope-side", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P", guardrails: ["g1", "g2"] } },
      guardrails: {
        g1: { description: "d1", scope: { agents: ["a1"] } },
        g2: { description: "d2", scope: {} },
        g3: { description: "d3", scope: { agents: ["a1"] } },
      },
    });
    const result = resolveEffectiveGuardrails(dsl, "agents", "a1");
    expect(result).toHaveLength(3);
    const ids = result.map((e) => e.guardrail_id).sort();
    expect(ids).toEqual(["g1", "g2", "g3"]);
    expect(result.find((e) => e.guardrail_id === "g1")!.source).toBe("both");
    expect(result.find((e) => e.guardrail_id === "g2")!.source).toBe("entity");
    expect(result.find((e) => e.guardrail_id === "g3")!.source).toBe("scope");
  });

  it("returns empty array when no guardrails", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P" } },
    });
    const result = resolveEffectiveGuardrails(dsl, "agents", "a1");
    expect(result).toHaveLength(0);
  });

  it("includes policy severity and action when available", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P", guardrails: ["g1"] } },
      guardrails: { g1: { description: "d", scope: {}, rationale: "reason", tags: ["safety"] } },
      guardrail_policies: {
        default: { rules: [{ guardrail: "g1", severity: "critical", action: "block" }] },
      },
    });
    const result = resolveEffectiveGuardrails(dsl, "agents", "a1");
    expect(result[0].severity).toBe("critical");
    expect(result[0].action).toBe("block");
    expect(result[0].rationale).toBe("reason");
    expect(result[0].tags).toEqual(["safety"]);
  });

  it("passes through conditional policy action", () => {
    const conditionalAction = {
      default: "block",
      when: { maintenance: "shadow" },
    };
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P", guardrails: ["g1"] } },
      guardrails: { g1: { description: "d", scope: {} } },
      guardrail_policies: {
        default: {
          rules: [{ guardrail: "g1", severity: "critical", action: conditionalAction }],
        },
      },
    });
    const result = resolveEffectiveGuardrails(dsl, "agents", "a1");
    expect(result[0].action).toEqual(conditionalAction);
  });

  it("skips entity references to non-existent guardrails", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P", guardrails: ["nonexistent"] } },
    });
    const result = resolveEffectiveGuardrails(dsl, "agents", "a1");
    expect(result).toHaveLength(0);
  });

  it("works for tasks", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P", can_return_handoffs: ["h", "r"] } },
      tasks: {
        t1: {
          description: "d", target_agent: "a1", allowed_from_agents: ["a1"],
          workflow: "implement", input_artifacts: [], invocation_handoff: "h", result_handoff: "r",
          guardrails: ["g1"],
        },
      },
      handoff_types: { h: { version: 1, schema: {} }, r: { version: 1, schema: {} } },
      guardrails: { g1: { description: "d", scope: { tasks: ["t1"] } } },
    });
    const result = resolveEffectiveGuardrails(dsl, "tasks", "t1");
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe("both");
  });

  it("works for tools", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P" } },
      tools: { t1: { kind: "cli", invokable_by: ["a1"], guardrails: ["g1"] } },
      guardrails: { g1: { description: "d", scope: {} } },
    });
    const result = resolveEffectiveGuardrails(dsl, "tools", "t1");
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe("entity");
  });

  it("works for artifacts", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P" } },
      artifacts: {
        art1: {
          type: "code", owner: "a1", producers: ["a1"], editors: ["a1"],
          consumers: ["a1"], states: ["draft"],
        },
      },
      guardrails: { g1: { description: "d", scope: { artifacts: ["art1"] } } },
    });
    const result = resolveEffectiveGuardrails(dsl, "artifacts", "art1");
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe("scope");
  });
});

// -- Context builders with relatedGuardrails --

describe("context builders include relatedGuardrails", () => {
  it("buildPerAgentContext includes relatedGuardrails", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P", guardrails: ["g1"] } },
      guardrails: { g1: { description: "d", scope: { agents: ["a1"] } } },
    });
    const ctx = buildPerAgentContext(dsl, { ...dsl.agents.a1, id: "a1" });
    expect(ctx.relatedGuardrails).toHaveLength(1);
    expect(ctx.relatedGuardrails[0].guardrail_id).toBe("g1");
    expect(ctx.relatedGuardrails[0].source).toBe("both");
  });

  it("buildTaskContext includes relatedGuardrails", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P", can_return_handoffs: ["h", "r"] } },
      tasks: {
        t1: {
          description: "d", target_agent: "a1", allowed_from_agents: ["a1"],
          workflow: "implement", input_artifacts: [], invocation_handoff: "h", result_handoff: "r",
          guardrails: ["g1"],
        },
      },
      handoff_types: { h: { version: 1, schema: {} }, r: { version: 1, schema: {} } },
      guardrails: { g1: { description: "d", scope: {} } },
    });
    const ctx = buildTaskContext(dsl, "t1");
    expect(ctx.relatedGuardrails).toHaveLength(1);
    expect(ctx.relatedGuardrails[0].source).toBe("entity");
  });

  it("buildToolContext includes relatedGuardrails", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P" } },
      tools: { t1: { kind: "cli", invokable_by: ["a1"] } },
      guardrails: { g1: { description: "d", scope: { tools: ["t1"] } } },
    });
    const ctx = buildToolContext(dsl, "t1");
    expect(ctx.relatedGuardrails).toHaveLength(1);
    expect(ctx.relatedGuardrails[0].source).toBe("scope");
  });

  it("buildArtifactContext includes relatedGuardrails", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P" } },
      artifacts: {
        art1: {
          type: "code", owner: "a1", producers: ["a1"], editors: ["a1"],
          consumers: ["a1"], states: ["draft"], guardrails: ["g1"],
        },
      },
      guardrails: { g1: { description: "d", scope: {} } },
    });
    const ctx = buildArtifactContext(dsl, "art1");
    expect(ctx.relatedGuardrails).toHaveLength(1);
    expect(ctx.relatedGuardrails[0].source).toBe("entity");
  });

  it("context relatedGuardrails is empty when no guardrails", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P" } },
    });
    const ctx = buildPerAgentContext(dsl, { ...dsl.agents.a1, id: "a1" });
    expect(ctx.relatedGuardrails).toHaveLength(0);
  });
});

// -- checkReferences --

describe("checkReferences entity guardrail refs", () => {
  it("reports invalid guardrail reference on agent", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P", guardrails: ["nonexistent"] } },
    });
    const diags = checkReferences(dsl);
    const found = diags.filter((d) => d.code === "entity-guardrail-ref-not-found");
    expect(found).toHaveLength(1);
    expect(found[0].path).toBe("agents.a1.guardrails");
    expect(found[0].message).toContain("nonexistent");
  });

  it("reports invalid guardrail reference on task", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P", can_return_handoffs: ["h", "r"] } },
      tasks: {
        t1: {
          description: "d", target_agent: "a1", allowed_from_agents: ["a1"],
          workflow: "implement", input_artifacts: [], invocation_handoff: "h", result_handoff: "r",
          guardrails: ["bad"],
        },
      },
      handoff_types: { h: { version: 1, schema: {} }, r: { version: 1, schema: {} } },
    });
    const diags = checkReferences(dsl);
    const found = diags.filter((d) => d.code === "entity-guardrail-ref-not-found");
    expect(found).toHaveLength(1);
    expect(found[0].path).toBe("tasks.t1.guardrails");
  });

  it("reports invalid guardrail reference on tool", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P" } },
      tools: { t1: { kind: "cli", invokable_by: ["a1"], guardrails: ["bad"] } },
    });
    const diags = checkReferences(dsl);
    const found = diags.filter((d) => d.code === "entity-guardrail-ref-not-found");
    expect(found).toHaveLength(1);
    expect(found[0].path).toBe("tools.t1.guardrails");
  });

  it("reports invalid guardrail reference on artifact", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P" } },
      artifacts: {
        art1: {
          type: "code", owner: "a1", producers: ["a1"], editors: ["a1"],
          consumers: ["a1"], states: ["draft"], guardrails: ["bad"],
        },
      },
    });
    const diags = checkReferences(dsl);
    const found = diags.filter((d) => d.code === "entity-guardrail-ref-not-found");
    expect(found).toHaveLength(1);
    expect(found[0].path).toBe("artifacts.art1.guardrails");
  });

  it("passes when guardrail references are valid", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P", guardrails: ["g1"] } },
      guardrails: { g1: { description: "d", scope: {} } },
    });
    const diags = checkReferences(dsl);
    const found = diags.filter((d) => d.code === "entity-guardrail-ref-not-found");
    expect(found).toHaveLength(0);
  });
});

// -- Lint rules --

describe("entity-guardrail-undefined lint rule", () => {
  it("reports error when entity references undefined guardrail", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P", guardrails: ["nonexistent"] } },
    });
    const diags = entityGuardrailUndefinedRule.run(dsl);
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe("error");
    expect(diags[0].message).toContain("nonexistent");
  });

  it("reports errors for all entity types", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P", guardrails: ["bad1"], can_return_handoffs: ["h", "r"] } },
      tasks: {
        t1: {
          description: "d", target_agent: "a1", allowed_from_agents: ["a1"],
          workflow: "implement", input_artifacts: [], invocation_handoff: "h", result_handoff: "r",
          guardrails: ["bad2"],
        },
      },
      tools: { tool1: { kind: "cli", invokable_by: ["a1"], guardrails: ["bad3"] } },
      artifacts: {
        art1: {
          type: "code", owner: "a1", producers: ["a1"], editors: ["a1"],
          consumers: ["a1"], states: ["draft"], guardrails: ["bad4"],
        },
      },
      handoff_types: { h: { version: 1, schema: {} }, r: { version: 1, schema: {} } },
    });
    const diags = entityGuardrailUndefinedRule.run(dsl);
    expect(diags).toHaveLength(4);
  });

  it("clean when all references are valid", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P", guardrails: ["g1"] } },
      guardrails: { g1: { description: "d", scope: {} } },
    });
    const diags = entityGuardrailUndefinedRule.run(dsl);
    expect(diags).toHaveLength(0);
  });
});

describe("entity-no-guardrails lint rule", () => {
  it("reports info when entity has no effective guardrails", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P" } },
    });
    const diags = entityNoGuardrailsRule.run(dsl);
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe("info");
    expect(diags[0].message).toContain("a1");
  });

  it("clean when entity has entity-side guardrails", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P", guardrails: ["g1"] } },
      guardrails: { g1: { description: "d", scope: {} } },
    });
    const diags = entityNoGuardrailsRule.run(dsl);
    expect(diags).toHaveLength(0);
  });

  it("clean when entity has scope-side guardrails", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P" } },
      guardrails: { g1: { description: "d", scope: { agents: ["a1"] } } },
    });
    const diags = entityNoGuardrailsRule.run(dsl);
    expect(diags).toHaveLength(0);
  });
});

describe("guardrail-orphaned lint rule", () => {
  it("reports warning when guardrail is not referenced by any entity and has empty scope", () => {
    const dsl = makeDsl({
      guardrails: { g1: { description: "d", scope: {} } },
    });
    const diags = guardrailOrphanedRule.run(dsl);
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe("warning");
    expect(diags[0].message).toContain("g1");
  });

  it("clean when guardrail is referenced by entity", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P", guardrails: ["g1"] } },
      guardrails: { g1: { description: "d", scope: {} } },
    });
    const diags = guardrailOrphanedRule.run(dsl);
    expect(diags).toHaveLength(0);
  });

  it("clean when guardrail has scope bindings", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P" } },
      guardrails: { g1: { description: "d", scope: { agents: ["a1"] } } },
    });
    const diags = guardrailOrphanedRule.run(dsl);
    expect(diags).toHaveLength(0);
  });

  it("clean when guardrail has workflow scope", () => {
    const dsl = makeDsl({
      guardrails: { g1: { description: "d", scope: { workflows: ["implement"] } } },
    });
    const diags = guardrailOrphanedRule.run(dsl);
    expect(diags).toHaveLength(0);
  });
});

// -- Scorer --

describe("entity-guardrail-coverage scorer", () => {
  it("scores 100% when all entities have guardrails", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P", guardrails: ["g1"] } },
      guardrails: { g1: { description: "d", scope: {} } },
    });
    const result = score(dsl);
    const d = result.dimensions.find((d) => d.id === "entity-guardrail-coverage")!;
    expect(d.percent).toBe(100);
    expect(d.recommendations).toHaveLength(0);
  });

  it("scores 0% when no entities have guardrails", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P" } },
    });
    const result = score(dsl);
    const d = result.dimensions.find((d) => d.id === "entity-guardrail-coverage")!;
    expect(d.percent).toBe(0);
    expect(d.recommendations[0]).toContain("agents.a1");
  });

  it("counts scope-side guardrails as coverage", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P" } },
      guardrails: { g1: { description: "d", scope: { agents: ["a1"] } } },
    });
    const result = score(dsl);
    const d = result.dimensions.find((d) => d.id === "entity-guardrail-coverage")!;
    expect(d.percent).toBe(100);
  });

  it("scores 100% for empty DSL", () => {
    const dsl = makeDsl({});
    const result = score(dsl);
    const d = result.dimensions.find((d) => d.id === "entity-guardrail-coverage")!;
    expect(d.percent).toBe(100);
  });

  it("scores mixed coverage correctly", () => {
    const dsl = makeDsl({
      agents: {
        a1: { role_name: "R", purpose: "P", guardrails: ["g1"] },
        a2: { role_name: "R", purpose: "P" },
      },
      guardrails: { g1: { description: "d", scope: {} } },
    });
    const result = score(dsl);
    const d = result.dimensions.find((d) => d.id === "entity-guardrail-coverage")!;
    expect(d.percent).toBe(50);
    expect(d.score).toBe(1);
    expect(d.total).toBe(2);
  });
});

// -- Integration: lint() includes new rules --

describe("lint() integration", () => {
  it("includes entity-guardrail-undefined diagnostics", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P", guardrails: ["nonexistent"] } },
    });
    const diags = lint(dsl);
    expect(diags.some((d) => d.ruleId === "entity-guardrail-undefined")).toBe(true);
  });

  it("includes entity-no-guardrails diagnostics", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P" } },
    });
    const diags = lint(dsl);
    expect(diags.some((d) => d.ruleId === "entity-no-guardrails")).toBe(true);
  });

  it("includes guardrail-orphaned diagnostics", () => {
    const dsl = makeDsl({
      guardrails: { g1: { description: "d", scope: {} } },
    });
    const diags = lint(dsl);
    expect(diags.some((d) => d.ruleId === "guardrail-orphaned")).toBe(true);
  });
});
