import { describe, it, expect } from "vitest";
import { mergeBinding } from "../../src/config/binding-merger.js";

describe("mergeBinding", () => {
  it("returns project fields when base is empty", () => {
    const base = { software: "cursor", version: 1 };
    const project = {
      extends: "./base.yaml",
      software: "cursor",
      version: 1,
      guardrail_impl: { gr1: { checks: [{ message: "a" }] } },
    };
    const result = mergeBinding(base, project);
    expect(result["guardrail_impl"]).toEqual({
      gr1: { checks: [{ message: "a" }] },
    });
    expect(result["extends"]).toBeUndefined();
  });

  it("merges guardrail_impl maps from base and project (disjoint keys)", () => {
    const base = {
      software: "cursor",
      version: 1,
      guardrail_impl: {
        gr1: { checks: [{ message: "base-1" }] },
        gr2: { checks: [{ message: "base-2" }] },
      },
    };
    const project = {
      extends: "./base.yaml",
      software: "cursor",
      version: 1,
      guardrail_impl: {
        gr3: { checks: [{ message: "proj-3" }] },
      },
    };
    const result = mergeBinding(base, project) as Record<string, unknown>;
    const impl = result["guardrail_impl"] as Record<string, unknown>;
    expect(Object.keys(impl)).toEqual(
      expect.arrayContaining(["gr1", "gr2", "gr3"]),
    );
    expect(Object.keys(impl)).toHaveLength(3);
  });

  it("project guardrail_impl overrides base for same key", () => {
    const base = {
      software: "cursor",
      version: 1,
      guardrail_impl: {
        gr1: { checks: [{ message: "base" }] },
      },
    };
    const project = {
      extends: "./base.yaml",
      software: "cursor",
      version: 1,
      guardrail_impl: {
        gr1: { checks: [{ message: "project" }] },
      },
    };
    const result = mergeBinding(base, project) as Record<string, unknown>;
    const impl = result["guardrail_impl"] as Record<string, { checks: unknown[] }>;
    expect(impl["gr1"]!.checks).toEqual([{ message: "project" }]);
  });

  it("merges outputs maps from base and project", () => {
    const base = {
      software: "cursor",
      version: 1,
      outputs: {
        "hook-script": { target: "a", mode: "write", inline_template: "x" },
      },
    };
    const project = {
      extends: "./base.yaml",
      software: "cursor",
      version: 1,
      outputs: {
        "policy-bundle": { target: "b", mode: "write", inline_template: "y" },
      },
    };
    const result = mergeBinding(base, project) as Record<string, unknown>;
    const outputs = result["outputs"] as Record<string, unknown>;
    expect(Object.keys(outputs)).toEqual(
      expect.arrayContaining(["hook-script", "policy-bundle"]),
    );
  });

  it("project outputs override base for same key", () => {
    const base = {
      software: "cursor",
      version: 1,
      outputs: {
        "policy-bundle": {
          target: "base-path",
          mode: "write",
          inline_template: "base",
        },
      },
    };
    const project = {
      extends: "./base.yaml",
      software: "cursor",
      version: 1,
      outputs: {
        "policy-bundle": {
          target: "project-path",
          mode: "write",
          inline_template: "project",
        },
      },
    };
    const result = mergeBinding(base, project) as Record<string, unknown>;
    const outputs = result["outputs"] as Record<string, { target: string }>;
    expect(outputs["policy-bundle"]!.target).toBe("project-path");
  });

  it("project software overrides base software", () => {
    const base = { software: "base-soft", version: 1 };
    const project = { extends: "./b.yaml", software: "proj-soft", version: 1 };
    const result = mergeBinding(base, project);
    expect(result["software"]).toBe("proj-soft");
  });

  it("inherits base guardrail_impl when project omits it", () => {
    const base = {
      software: "cursor",
      version: 1,
      guardrail_impl: { gr1: { checks: [{ message: "base" }] } },
    };
    const project = { extends: "./base.yaml", software: "cursor", version: 1 };
    const result = mergeBinding(base, project) as Record<string, unknown>;
    const impl = result["guardrail_impl"] as Record<string, unknown>;
    expect(impl["gr1"]).toBeDefined();
  });

  it("inherits base outputs when project omits outputs", () => {
    const base = {
      software: "cursor",
      version: 1,
      outputs: {
        out1: { target: "t", mode: "write", inline_template: "x" },
      },
    };
    const project = { extends: "./base.yaml", software: "cursor", version: 1 };
    const result = mergeBinding(base, project) as Record<string, unknown>;
    const outputs = result["outputs"] as Record<string, unknown>;
    expect(outputs["out1"]).toBeDefined();
  });

  it("deep-merges reporting from base and project", () => {
    const base = {
      software: "observ",
      version: 1,
      reporting: {
        commands: { emit: "observ emit", on_fail: "observ fail" },
        fail_open: true,
        timeout_ms: 5000,
      },
    };
    const project = {
      extends: "./base.yaml",
      software: "observ",
      version: 1,
      reporting: {
        timeout_ms: 3000,
      },
    };
    const result = mergeBinding(base, project) as Record<string, unknown>;
    const reporting = result["reporting"] as Record<string, unknown>;
    expect(reporting["timeout_ms"]).toBe(3000);
    expect(reporting["fail_open"]).toBe(true);
    expect(reporting["commands"]).toEqual({ emit: "observ emit", on_fail: "observ fail" });
  });

  it("strips extends from the merged result", () => {
    const base = { software: "cursor", version: 1 };
    const project = { extends: "./base.yaml", software: "cursor", version: 1 };
    const result = mergeBinding(base, project);
    expect(result["extends"]).toBeUndefined();
  });

  it("preserves passthrough fields from base and project", () => {
    const base = { software: "cursor", version: 1, "x-base-meta": "from-base" };
    const project = {
      extends: "./base.yaml",
      software: "cursor",
      version: 1,
      "x-proj-meta": "from-proj",
    };
    const result = mergeBinding(base, project);
    expect(result["x-base-meta"]).toBe("from-base");
    expect(result["x-proj-meta"]).toBe("from-proj");
  });

  it("concatenates renders arrays from base and project", () => {
    const base = {
      software: "cursor",
      version: 1,
      renders: [
        { context: "system", output: "sys.md", inline_template: "base" },
      ],
    };
    const project = {
      extends: "./base.yaml",
      software: "cursor",
      version: 1,
      renders: [
        { context: "agent", output: "{agent.id}.md", inline_template: "proj" },
      ],
    };
    const result = mergeBinding(base, project);
    const renders = result["renders"] as unknown[];
    expect(renders).toHaveLength(2);
    expect(renders[0]).toEqual(expect.objectContaining({ context: "system" }));
    expect(renders[1]).toEqual(expect.objectContaining({ context: "agent" }));
  });

  it("uses only project renders when base has none", () => {
    const base = { software: "cursor", version: 1 };
    const project = {
      extends: "./base.yaml",
      software: "cursor",
      version: 1,
      renders: [
        { context: "system", output: "out.md", inline_template: "only-proj" },
      ],
    };
    const result = mergeBinding(base, project);
    const renders = result["renders"] as unknown[];
    expect(renders).toHaveLength(1);
  });

  it("keeps base renders when project has none", () => {
    const base = {
      software: "cursor",
      version: 1,
      renders: [
        { context: "system", output: "out.md", inline_template: "only-base" },
      ],
    };
    const project = {
      extends: "./base.yaml",
      software: "cursor",
      version: 1,
    };
    const result = mergeBinding(base, project);
    const renders = result["renders"] as unknown[];
    expect(renders).toHaveLength(1);
  });

  it("applies $replace operator on renders", () => {
    const base = {
      software: "cursor",
      version: 1,
      renders: [
        { context: "system", output: "base.md", inline_template: "base-tpl" },
      ],
    };
    const project = {
      extends: "./base.yaml",
      software: "cursor",
      version: 1,
      renders: {
        $replace: [
          { context: "agent", output: "child.md", inline_template: "child-tpl" },
        ],
      },
    };
    const result = mergeBinding(base, project);
    const renders = result["renders"] as unknown[];
    expect(renders).toHaveLength(1);
    expect(renders[0]).toEqual(
      expect.objectContaining({ context: "agent", output: "child.md" }),
    );
  });

  it("applies $append operator on renders", () => {
    const base = {
      software: "cursor",
      version: 1,
      renders: [
        { context: "system", output: "base.md", inline_template: "base-tpl" },
      ],
    };
    const project = {
      extends: "./base.yaml",
      software: "cursor",
      version: 1,
      renders: {
        $append: [
          { context: "agent", output: "added.md", inline_template: "added" },
        ],
      },
    };
    const result = mergeBinding(base, project);
    const renders = result["renders"] as unknown[];
    expect(renders).toHaveLength(2);
    expect(renders[0]).toEqual(expect.objectContaining({ context: "system" }));
    expect(renders[1]).toEqual(expect.objectContaining({ context: "agent" }));
  });

  it("applies $remove operator on renders by id", () => {
    const base = {
      software: "cursor",
      version: 1,
      renders: [
        { id: "r1", context: "system", output: "sys.md", inline_template: "s" },
        { id: "r2", context: "agent", output: "agent.md", inline_template: "a" },
      ],
    };
    const project = {
      extends: "./base.yaml",
      software: "cursor",
      version: 1,
      renders: {
        $remove: [{ id: "r1" }],
      },
    };
    const result = mergeBinding(base, project);
    const renders = result["renders"] as unknown[];
    expect(renders).toHaveLength(1);
    expect(renders[0]).toEqual(expect.objectContaining({ id: "r2" }));
  });

  it("applies $prepend operator on renders", () => {
    const base = {
      software: "cursor",
      version: 1,
      renders: [
        { context: "system", output: "base.md", inline_template: "base-tpl" },
      ],
    };
    const project = {
      extends: "./base.yaml",
      software: "cursor",
      version: 1,
      renders: {
        $prepend: [
          { context: "agent", output: "first.md", inline_template: "first" },
        ],
      },
    };
    const result = mergeBinding(base, project);
    const renders = result["renders"] as unknown[];
    expect(renders).toHaveLength(2);
    expect(renders[0]).toEqual(expect.objectContaining({ context: "agent" }));
    expect(renders[1]).toEqual(expect.objectContaining({ context: "system" }));
  });

  it("applies $replace on reporting section (object mode)", () => {
    const base = {
      software: "cursor",
      version: 1,
      reporting: {
        commands: { lint: "npm run lint" },
        fail_open: true,
      },
    };
    const project = {
      extends: "./base.yaml",
      software: "cursor",
      version: 1,
      reporting: {
        $replace: { commands: { test: "npm test" }, fail_open: false },
      },
    };
    const result = mergeBinding(base, project);
    const reporting = result["reporting"] as Record<string, unknown>;
    expect(reporting["commands"]).toEqual({ test: "npm test" });
    expect(reporting["fail_open"]).toBe(false);
  });
});
