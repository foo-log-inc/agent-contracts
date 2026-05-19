import { resolve as resolvePath, join } from "node:path";
import { describe, it, expect } from "vitest";
import { mergeDsl, MergeError } from "../../src/resolver/merger.js";
import { BaseResolveError } from "../../src/resolver/base-resolver.js";
import { resolve } from "../../src/resolver/resolve.js";

const fixturesDir = resolvePath(import.meta.dirname, "../fixtures");

describe("mergeDsl", () => {
  const base = {
    version: 1,
    system: { id: "base", name: "Base", default_workflow_order: ["a"] },
    agents: {
      "agent-1": {
        role_name: "R",
        purpose: "P",
        constraints: ["c1"],
        rules: [{ id: "R1", description: "d", severity: "mandatory" }],
      },
    },
    tasks: {
      "task-1": {
        description: "d",
        target_agent: "agent-1",
        allowed_from_agents: ["agent-1"],
        workflow: "a",
        input_artifacts: [],
        invocation_handoff: "h",
        result_handoff: "r",
        execution_steps: [
          { id: "s1", action: "Step 1" },
          { id: "s2", action: "Step 2" },
        ],
      },
    },
    artifacts: {
      "art-1": { type: "code", owner: "agent-1", producers: [], editors: [], consumers: [], states: [] },
    },
  };

  it("merges same-key entities via deep merge", () => {
    const project = {
      extends: "./base/",
      agents: { "agent-1": { purpose: "Updated" } },
    };
    const result = mergeDsl(base, project);
    const agents = result["agents"] as Record<string, Record<string, unknown>>;
    expect(agents["agent-1"]).toBeDefined();
    expect(agents["agent-1"]["purpose"]).toBe("Updated");
    expect(agents["agent-1"]["role_name"]).toBe("R");
  });

  it("adds new key entities", () => {
    const project = {
      extends: "./base/",
      agents: { "agent-2": { role_name: "New", purpose: "New agent" } },
    };
    const result = mergeDsl(base, project);
    const agents = result["agents"] as Record<string, Record<string, unknown>>;
    expect(Object.keys(agents)).toHaveLength(2);
    expect(agents["agent-2"]).toBeDefined();
  });

  it("applies $append operator", () => {
    const project = {
      extends: "./base/",
      agents: { "agent-1": { constraints: { $append: ["c2"] } } },
    };
    const result = mergeDsl(base, project);
    const agents = result["agents"] as Record<string, Record<string, unknown>>;
    expect(agents["agent-1"]["constraints"]).toEqual(["c1", "c2"]);
  });

  it("applies $prepend operator", () => {
    const project = {
      extends: "./base/",
      agents: { "agent-1": { constraints: { $prepend: ["c0"] } } },
    };
    const result = mergeDsl(base, project);
    const agents = result["agents"] as Record<string, Record<string, unknown>>;
    expect(agents["agent-1"]["constraints"]).toEqual(["c0", "c1"]);
  });

  it("applies $insert_after operator", () => {
    const project = {
      extends: "./base/",
      tasks: {
        "task-1": {
          execution_steps: {
            $insert_after: {
              target: "s1",
              items: [{ id: "s1b", action: "Step 1b" }],
            },
          },
        },
      },
    };
    const result = mergeDsl(base, project);
    const tasks = result["tasks"] as Record<string, Record<string, unknown>>;
    const steps = tasks["task-1"]["execution_steps"] as Array<Record<string, unknown>>;
    expect(steps).toHaveLength(3);
    expect(steps[0]["id"]).toBe("s1");
    expect(steps[1]["id"]).toBe("s1b");
    expect(steps[2]["id"]).toBe("s2");
  });

  it("throws on $insert_after with missing target", () => {
    const project = {
      extends: "./base/",
      tasks: {
        "task-1": {
          execution_steps: {
            $insert_after: {
              target: "nonexistent",
              items: [{ id: "x", action: "X" }],
            },
          },
        },
      },
    };
    expect(() => mergeDsl(base, project)).toThrow(MergeError);
    expect(() => mergeDsl(base, project)).toThrow("not found");
  });

  it("applies $insert_after on string arrays by value", () => {
    const project = {
      extends: "./base/",
      agents: {
        "agent-1": {
          constraints: {
            $insert_after: {
              target: "c1",
              items: ["c1.5"],
            },
          },
        },
      },
    };
    const result = mergeDsl(base, project);
    const agents = result["agents"] as Record<string, Record<string, unknown>>;
    expect(agents["agent-1"]["constraints"]).toEqual(["c1", "c1.5"]);
  });

  it("applies $replace operator", () => {
    const project = {
      extends: "./base/",
      agents: {
        "agent-1": {
          constraints: { $replace: ["only-this"] },
        },
      },
    };
    const result = mergeDsl(base, project);
    const agents = result["agents"] as Record<string, Record<string, unknown>>;
    expect(agents["agent-1"]["constraints"]).toEqual(["only-this"]);
  });

  it("applies $remove operator", () => {
    const project = {
      extends: "./base/",
      agents: {
        "agent-1": {
          rules: { $remove: [{ id: "R1" }] },
        },
      },
    };
    const result = mergeDsl(base, project);
    const agents = result["agents"] as Record<string, Record<string, unknown>>;
    expect(agents["agent-1"]["rules"]).toEqual([]);
  });

  it("throws on $remove with non-existent id", () => {
    const project = {
      extends: "./base/",
      agents: {
        "agent-1": {
          rules: { $remove: [{ id: "nonexistent" }] },
        },
      },
    };
    expect(() => mergeDsl(base, project)).toThrow(MergeError);
    expect(() => mergeDsl(base, project)).toThrow("not found");
  });

  it("applies $remove on string arrays by value", () => {
    const project = {
      extends: "./base/",
      agents: {
        "agent-1": {
          constraints: { $remove: ["c1"] },
        },
      },
    };
    const result = mergeDsl(base, project);
    const agents = result["agents"] as Record<string, Record<string, unknown>>;
    expect(agents["agent-1"]["constraints"]).toEqual([]);
  });

  it("applies $remove on string arrays preserving remaining items", () => {
    const baseMulti = {
      ...base,
      agents: {
        "agent-1": {
          ...base.agents["agent-1"],
          constraints: ["c1", "c2", "c3"],
        },
      },
    };
    const project = {
      extends: "./base/",
      agents: {
        "agent-1": {
          constraints: { $remove: ["c2"] },
        },
      },
    };
    const result = mergeDsl(baseMulti, project);
    const agents = result["agents"] as Record<string, Record<string, unknown>>;
    expect(agents["agent-1"]["constraints"]).toEqual(["c1", "c3"]);
  });

  it("throws on $remove with non-existent string value", () => {
    const project = {
      extends: "./base/",
      agents: {
        "agent-1": {
          constraints: { $remove: ["nonexistent"] },
        },
      },
    };
    expect(() => mergeDsl(base, project)).toThrow(MergeError);
    expect(() => mergeDsl(base, project)).toThrow("not found");
  });

  it("$remove with empty array is no-op", () => {
    const project = {
      extends: "./base/",
      agents: {
        "agent-1": {
          constraints: { $remove: [] },
        },
      },
    };
    const result = mergeDsl(base, project);
    const agents = result["agents"] as Record<string, Record<string, unknown>>;
    expect(agents["agent-1"]["constraints"]).toEqual(["c1"]);
  });

  it("map $remove with sibling property overrides", () => {
    const baseWithTwo = {
      ...base,
      agents: {
        "agent-1": base.agents["agent-1"],
        "agent-2": { role_name: "R2", purpose: "P2", constraints: ["x"] },
      },
    };
    const project = {
      extends: "./base/",
      agents: {
        $remove: ["agent-2"],
        "agent-1": { constraints: { $append: ["c2"] } },
      },
    };
    const result = mergeDsl(baseWithTwo, project);
    const agents = result["agents"] as Record<string, Record<string, unknown>>;
    expect(agents["agent-2"]).toBeUndefined();
    expect(agents["agent-1"]["constraints"]).toEqual(["c1", "c2"]);
  });

  it("map $append with sibling property overrides", () => {
    const project = {
      extends: "./base/",
      agents: {
        $append: { "agent-new": { role_name: "New", purpose: "New" } },
        "agent-1": { constraints: { $prepend: ["c0"] } },
      },
    };
    const result = mergeDsl(base, project);
    const agents = result["agents"] as Record<string, Record<string, unknown>>;
    expect(agents["agent-new"]).toBeDefined();
    expect(agents["agent-new"]["role_name"]).toBe("New");
    expect(agents["agent-1"]["constraints"]).toEqual(["c0", "c1"]);
  });

  it("throws on multiple merge operators in same object", () => {
    const project = {
      extends: "./base/",
      agents: {
        $remove: ["agent-1"],
        $append: { "agent-new": { role_name: "N", purpose: "P" } },
      },
    };
    expect(() => mergeDsl(base, project)).toThrow(MergeError);
    expect(() => mergeDsl(base, project)).toThrow(/Multiple merge operators/);
  });

  it("throws on multiple operators in nested property", () => {
    const project = {
      extends: "./base/",
      agents: {
        "agent-1": {
          constraints: { $append: ["c2"], $prepend: ["c0"] },
        },
      },
    };
    expect(() => mergeDsl(base, project)).toThrow(MergeError);
    expect(() => mergeDsl(base, project)).toThrow(/Multiple merge operators/);
  });

  it("map $insert_after with overlapping existing key after anchor", () => {
    const baseWithThree = {
      ...base,
      agents: {
        "agent-a": { role_name: "A", purpose: "PA" },
        "agent-b": { role_name: "B", purpose: "PB" },
        "agent-c": { role_name: "C", purpose: "PC" },
      },
    };
    const project = {
      extends: "./base/",
      agents: {
        $insert_after: {
          after: "agent-a",
          entries: { "agent-c": { role_name: "C-updated", purpose: "PC-new" } },
        },
      },
    };
    const result = mergeDsl(baseWithThree, project);
    const agents = result["agents"] as Record<string, Record<string, unknown>>;
    expect(agents["agent-c"]["role_name"]).toBe("C-updated");
    const keys = Object.keys(agents);
    expect(keys.filter((k) => k === "agent-c")).toHaveLength(1);
    expect(keys[0]).toBe("agent-a");
    expect(keys[1]).toBe("agent-c");
    expect(keys[2]).toBe("agent-b");
  });

  it("scalar fields are directly overwritten", () => {
    const project = {
      extends: "./base/",
      artifacts: { "art-1": { description: "Updated desc" } },
    };
    const result = mergeDsl(base, project);
    const arts = result["artifacts"] as Record<string, Record<string, unknown>>;
    expect(arts["art-1"]["description"]).toBe("Updated desc");
    expect(arts["art-1"]["type"]).toBe("code");
  });

  it("merges x- properties same as standard properties", () => {
    const project = {
      extends: "./base/",
      agents: {
        "agent-1": {
          "x-stack-notes": "TypeScript",
          "x-guide": { $append: ["new-item"] },
        },
      },
    };
    const baseWithX = {
      ...base,
      agents: {
        "agent-1": {
          ...base.agents["agent-1"],
          "x-guide": ["existing-item"],
        },
      },
    };
    const result = mergeDsl(baseWithX, project);
    const agents = result["agents"] as Record<string, Record<string, unknown>>;
    expect(agents["agent-1"]["x-stack-notes"]).toBe("TypeScript");
    expect(agents["agent-1"]["x-guide"]).toEqual(["existing-item", "new-item"]);
  });

  it("errors when merge operators used without extends", () => {
    const project = {
      agents: { "agent-1": { constraints: { $append: ["c2"] } } },
    };
    expect(() => mergeDsl(base, project)).toThrow(MergeError);
    expect(() => mergeDsl(base, project)).toThrow("without extends");
  });

  it("applies $replace on system section (object mode)", () => {
    const project = {
      extends: "./base/",
      system: {
        $replace: { id: "new", name: "New System", default_workflow_order: ["b"] },
      },
    };
    const result = mergeDsl(base, project);
    const sys = result["system"] as Record<string, unknown>;
    expect(sys["id"]).toBe("new");
    expect(sys["name"]).toBe("New System");
    expect(sys["default_workflow_order"]).toEqual(["b"]);
  });

  it("applies nested operator on new entity key", () => {
    const project = {
      extends: "./base/",
      agents: {
        "agent-1": {
          constraints: { $append: ["c2"] },
        },
        "agent-new": {
          role_name: "New",
          purpose: "New purpose",
          constraints: { $replace: ["only-new"] },
        },
      },
    };
    const result = mergeDsl(base, project);
    const agents = result["agents"] as Record<string, Record<string, unknown>>;
    expect(agents["agent-1"]["constraints"]).toEqual(["c1", "c2"]);
    expect(agents["agent-new"]["constraints"]).toEqual(["only-new"]);
  });

  it("project > base priority (2-layer model)", () => {
    const project = {
      extends: "./base/",
      system: { name: "Project Name" },
      agents: { "agent-1": { purpose: "Project purpose" } },
    };
    const result = mergeDsl(base, project);
    expect((result["system"] as Record<string, unknown>)["name"]).toBe("Project Name");
    expect((result["system"] as Record<string, unknown>)["id"]).toBe("base");
    const agents = result["agents"] as Record<string, Record<string, unknown>>;
    expect(agents["agent-1"]["purpose"]).toBe("Project purpose");
    expect(agents["agent-1"]["role_name"]).toBe("R");
  });

  it("deep-merges extensions with per-key override from project", () => {
    const baseWithExt = {
      ...base,
      extensions: {
        "x-a": { type: "string", description: "from base a" },
        "x-b": { type: "string", description: "from base b" },
      },
    };
    const project = {
      extends: "./base/",
      extensions: {
        "x-b": { type: "string", description: "from project b" },
        "x-c": { type: "number", description: "from project c" },
      },
    };
    const result = mergeDsl(baseWithExt, project);
    const xext = result["extensions"] as Record<string, Record<string, unknown>>;
    expect(Object.keys(xext).sort()).toEqual(["x-a", "x-b", "x-c"]);
    expect(xext["x-a"]["description"]).toBe("from base a");
    expect(xext["x-b"]["description"]).toBe("from project b");
    expect(xext["x-c"]["description"]).toBe("from project c");
  });
});

describe("resolve() pipeline", () => {
  it("resolves standalone DSL (no extends)", async () => {
    const result = await resolve(
      join(fixturesDir, "minimal/agent-contracts.yaml"),
    );
    expect(result.data["version"]).toBe(1);
    expect(result.basePaths).toEqual([]);
  });

  it("resolves project with local base extends", async () => {
    const result = await resolve(
      join(fixturesDir, "base-resolve/project/agent-contracts.yaml"),
    );

    expect(result.basePaths.length).toBeGreaterThan(0);

    const agents = result.data["agents"] as Record<string, Record<string, unknown>>;
    const impl = agents["implementer"];
    expect(impl).toBeDefined();
    expect((impl["constraints"] as string[]).length).toBeGreaterThan(1);
    expect(impl["x-stack-notes"]).toBe("TypeScript service");

    const designer = agents["designer"];
    expect(designer).toBeDefined();

    const tasks = result.data["tasks"] as Record<string, Record<string, unknown>>;
    const task = tasks["implement-feature"];
    const steps = task["execution_steps"] as Array<Record<string, unknown>>;
    expect(steps.find((s) => s["id"] === "run-lint")).toBeDefined();

    const arts = result.data["artifacts"] as Record<string, Record<string, unknown>>;
    expect(arts["codebase"]["description"]).toBe("TypeScript monorepo");
  });

  it("resolves 3-level chained extends with merged guardrails", async () => {
    const childPath = join(
      fixturesDir,
      "chained-extends/child/agent-contracts.yaml",
    );
    const parentPath = join(
      fixturesDir,
      "chained-extends/parent/agent-contracts.yaml",
    );
    const grandparentPath = join(
      fixturesDir,
      "chained-extends/grandparent/agent-contracts.yaml",
    );

    const result = await resolve(childPath);

    const guardrails = result.data["guardrails"] as Record<
      string,
      Record<string, unknown>
    >;
    expect(guardrails["no-force-push"]["description"]).toBe(
      "Force push is forbidden",
    );
    expect(guardrails["no-force-push"]["scope"]).toBe("commit");
    expect(guardrails["no-rebase"]["description"]).toBe("Rebase is forbidden");
    expect(guardrails["no-squash"]["description"]).toBe("Squash is forbidden");

    expect(result.basePaths).toEqual([grandparentPath, parentPath]);
  });

  it("throws BaseResolveError on circular extends", async () => {
    await expect(
      resolve(
        join(fixturesDir, "circular-extends/a/agent-contracts.yaml"),
      ),
    ).rejects.toThrow(BaseResolveError);
    await expect(
      resolve(
        join(fixturesDir, "circular-extends/a/agent-contracts.yaml"),
      ),
    ).rejects.toThrow(/Circular/);
  });
});
