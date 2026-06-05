import { describe, expect, it } from "vitest";
import { MergeError } from "../../src/resolver/merger.js";
import { resolveClone, CloneError } from "../../src/resolver/clone.js";

describe("resolveClone", () => {
  const baseAgent = {
    role_name: "Implementer",
    purpose: "General-purpose implementer",
    mode: "read-write",
    can_write_artifacts: ["openapi-spec", "api-handler"],
    responsibilities: ["Implement changes safely"],
    rules: [
      {
        id: "R-IMPL-001",
        description: "Preserve existing structure",
        severity: "mandatory",
      },
    ],
    can_execute_tools: ["Read", "Edit", "Write"],
  };

  it("performs basic clone copying all fields from base", () => {
    const data = {
      agents: {
        implementer: baseAgent,
        "implementer.copy": {
          $clone: { from: "implementer" },
        },
      },
    };

    resolveClone(data);
    const agents = data.agents as Record<string, Record<string, unknown>>;

    expect(agents.implementer).toEqual(baseAgent);
    expect(agents["implementer.copy"]).toEqual(baseAgent);
    expect(agents["implementer.copy"]).not.toBe(agents.implementer);
  });

  it("clones with merge scalar overwrite and deep merge", () => {
    const data = {
      agents: {
        implementer: baseAgent,
        "implementer.api_contract": {
          $clone: {
            from: "implementer",
            merge: {
              purpose: "Implementer specialized for API contract changes",
              can_read_artifacts: ["api-handler", "api-test"],
            },
          },
        },
      },
    };

    resolveClone(data);
    const variant = (data.agents as Record<string, Record<string, unknown>>)[
      "implementer.api_contract"
    ];

    expect(variant.purpose).toBe(
      "Implementer specialized for API contract changes",
    );
    expect(variant.can_read_artifacts).toEqual(["api-handler", "api-test"]);
    expect(variant.role_name).toBe("Implementer");
    expect(variant.can_write_artifacts).toEqual([
      "openapi-spec",
      "api-handler",
    ]);
  });

  it("applies merge operators ($append, $prepend, $replace, $remove, $insert_after)", () => {
    const data = {
      agents: {
        base: {
          role_name: "R",
          purpose: "P",
          append_tags: ["a"],
          prepend_tags: ["b"],
          replace_tags: ["old"],
          remove_tags: ["keep", "drop", "stay"],
          steps: [
            { id: "s1", action: "first" },
            { id: "s2", action: "second" },
          ],
        },
        variant: {
          $clone: {
            from: "base",
            merge: {
              append_tags: { $append: ["c"] },
              prepend_tags: { $prepend: ["a"] },
              replace_tags: { $replace: ["new"] },
              remove_tags: { $remove: ["drop"] },
              steps: {
                $insert_after: {
                  target: "s1",
                  items: [{ id: "s1b", action: "between" }],
                },
              },
            },
          },
        },
      },
    };

    resolveClone(data);
    const variant = (data.agents as Record<string, Record<string, unknown>>).variant;

    expect(variant.append_tags).toEqual(["a", "c"]);
    expect(variant.prepend_tags).toEqual(["a", "b"]);
    expect(variant.replace_tags).toEqual(["new"]);
    expect(variant.remove_tags).toEqual(["keep", "stay"]);
    expect(variant.steps).toEqual([
      { id: "s1", action: "first" },
      { id: "s1b", action: "between" },
      { id: "s2", action: "second" },
    ]);
  });

  it("preserves base entity after clone", () => {
    const data = {
      agents: {
        implementer: { ...baseAgent },
        "implementer.variant": {
          $clone: {
            from: "implementer",
            merge: { purpose: "Variant" },
          },
        },
      },
    };

    resolveClone(data);
    const agents = data.agents as Record<string, Record<string, unknown>>;

    expect(agents.implementer.purpose).toBe("General-purpose implementer");
    expect(agents["implementer.variant"].purpose).toBe("Variant");
  });

  it("removes $clone key from output", () => {
    const data = {
      agents: {
        base: { role_name: "R", purpose: "P" },
        copy: { $clone: { from: "base" } },
      },
    };

    resolveClone(data);
    const copy = (data.agents as Record<string, Record<string, unknown>>).copy;

    expect(copy).not.toHaveProperty("$clone");
    expect(copy.role_name).toBe("R");
  });

  it("resolves chained clones (B from A from base)", () => {
    const data = {
      agents: {
        base: {
          role_name: "R",
          purpose: "Base purpose",
          can_write_artifacts: ["a", "b"],
        },
        "variant.a": {
          $clone: {
            from: "base",
            merge: {
              purpose: "Variant A",
              can_write_artifacts: { $replace: ["a"] },
            },
          },
        },
        "variant.b": {
          $clone: {
            from: "variant.a",
            merge: {
              purpose: "Variant B",
              can_read_artifacts: { $replace: ["x", "y"] },
            },
          },
        },
      },
    };

    resolveClone(data);
    const agents = data.agents as Record<string, Record<string, unknown>>;

    expect(agents["variant.a"].purpose).toBe("Variant A");
    expect(agents["variant.a"].can_write_artifacts).toEqual(["a"]);
    expect(agents["variant.b"].purpose).toBe("Variant B");
    expect(agents["variant.b"].can_write_artifacts).toEqual(["a"]);
    expect(agents["variant.b"].can_read_artifacts).toEqual(["x", "y"]);
    expect(agents.base.purpose).toBe("Base purpose");
  });

  it("throws CloneError when base is not found", () => {
    const data = {
      agents: {
        orphan: { $clone: { from: "missing" } },
      },
    };

    expect(() => resolveClone(data)).toThrow(CloneError);
    expect(() => resolveClone(data)).toThrow(
      'base "missing" not found in section "agents"',
    );
  });

  it("throws CloneError on circular reference", () => {
    const data = {
      agents: {
        a: { $clone: { from: "b" } },
        b: { $clone: { from: "a" } },
      },
    };

    expect(() => resolveClone(data)).toThrow(CloneError);
    expect(() => resolveClone(data)).toThrow(/circular reference detected/i);
  });

  it("clones across multiple sections in the same DSL", () => {
    const data = {
      agents: {
        "agent-base": { role_name: "A", purpose: "Agent base" },
        "agent-variant": {
          $clone: {
            from: "agent-base",
            merge: { purpose: "Agent variant" },
          },
        },
      },
      tasks: {
        "task-base": {
          description: "Task base",
          target_agent: "agent-base",
          workflow: "w",
          input_artifacts: [],
          invocation_handoff: "h",
          result_handoff: "r",
        },
        "task-variant": {
          $clone: {
            from: "task-base",
            merge: { description: "Task variant" },
          },
        },
      },
    };

    resolveClone(data);
    const agents = data.agents as Record<string, Record<string, unknown>>;
    const tasks = data.tasks as Record<string, Record<string, unknown>>;

    expect(agents["agent-variant"].purpose).toBe("Agent variant");
    expect(tasks["task-variant"].description).toBe("Task variant");
    expect(tasks["task-base"].description).toBe("Task base");
  });

  it("clones without merge as exact copy with different ID", () => {
    const data = {
      artifacts: {
        "art-base": { type: "code", owner: "agent-1" },
        "art-copy": { $clone: { from: "art-base" } },
      },
    };

    resolveClone(data);
    const artifacts = data.artifacts as Record<string, Record<string, unknown>>;

    expect(artifacts["art-copy"]).toEqual(artifacts["art-base"]);
    expect(artifacts["art-copy"]).not.toBe(artifacts["art-base"]);
  });

  it("supports all map-type sections", () => {
    const sections = [
      "agents",
      "tasks",
      "artifacts",
      "tools",
      "validations",
      "handoff_types",
      "imports",
      "workflow",
      "policies",
      "guardrails",
      "guardrail_policies",
      "components",
      "extensions",
    ] as const;

    const data: Record<string, unknown> = {};
    for (const section of sections) {
      data[section] = {
        base: { name: `${section}-base` },
        variant: {
          $clone: {
            from: "base",
            merge: { name: `${section}-variant` },
          },
        },
      };
    }

    resolveClone(data);

    for (const section of sections) {
      const map = data[section] as Record<string, Record<string, unknown>>;
      expect(map.base.name).toBe(`${section}-base`);
      expect(map.variant.name).toBe(`${section}-variant`);
      expect(map.variant).not.toHaveProperty("$clone");
    }
  });

  it("is a no-op when no $clone entries exist", () => {
    const data = {
      version: 1,
      agents: {
        a: { role_name: "R", purpose: "P" },
      },
    };
    const snapshot = structuredClone(data);

    resolveClone(data);
    expect(data).toEqual(snapshot);
  });

  it("propagates MergeError from invalid merge operators", () => {
    const data = {
      agents: {
        base: { tags: ["a"] },
        bad: {
          $clone: {
            from: "base",
            merge: {
              tags: { $remove: ["missing"] },
            },
          },
        },
      },
    };

    expect(() => resolveClone(data)).toThrow(MergeError);
  });
});
