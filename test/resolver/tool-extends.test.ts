import { describe, expect, it } from "vitest";
import {
  resolveToolExtends,
  ToolExtendsError,
} from "../../src/resolver/tool-extends.js";
import type { Tool } from "../../src/schema/tool.js";

describe("resolveToolExtends", () => {
  it("leaves tools without extends unchanged", () => {
    const tools: Record<string, Tool> = {
      standalone: {
        kind: "cli",
        invokable_by: ["agent-1"],
      },
    };

    const result = resolveToolExtends(tools);
    expect(result.standalone).toEqual(tools.standalone);
  });

  it("inherits artifact_bindings from base tool", () => {
    const tools: Record<string, Tool> = {
      base: {
        kind: "cli",
        cli_contract: "speckeeper",
        artifact_bindings: {
          "spec-source": "design-dir",
          config: "speckeeper-config",
        },
      },
      lint: {
        extends: "base",
        command: "lint",
      },
    };

    const result = resolveToolExtends(tools);
    expect(result.lint.artifact_bindings).toEqual({
      "spec-source": "design-dir",
      config: "speckeeper-config",
    });
    expect(result.lint.extends).toBe("base");
    expect(result.lint.command).toBe("lint");
  });

  it("lets child override specific artifact_bindings keys", () => {
    const tools: Record<string, Tool> = {
      base: {
        kind: "cli",
        artifact_bindings: {
          "spec-source": "design-dir",
          config: "speckeeper-config",
        },
      },
      custom: {
        extends: "base",
        command: "check",
        artifact_bindings: {
          config: "override-config",
        },
      },
    };

    const result = resolveToolExtends(tools);
    expect(result.custom.artifact_bindings).toEqual({
      "spec-source": "design-dir",
      config: "override-config",
    });
  });

  it("inherits kind and cli_contract from base", () => {
    const tools: Record<string, Tool> = {
      base: {
        kind: "cli",
        cli_contract: "speckeeper",
        description: "Base tool",
      },
      lint: {
        extends: "base",
        command: "lint",
      },
    };

    const result = resolveToolExtends(tools);
    expect(result.lint.kind).toBe("cli");
    expect(result.lint.cli_contract).toBe("speckeeper");
    expect(result.lint.description).toBe("Base tool");
  });

  it("preserves child command field", () => {
    const tools: Record<string, Tool> = {
      base: { kind: "cli", cli_contract: "eslint" },
      run: { extends: "base", command: "lint:fix" },
    };

    const result = resolveToolExtends(tools);
    expect(result.run.command).toBe("lint:fix");
  });

  it("inherits invokable_by when child list is empty", () => {
    const tools: Record<string, Tool> = {
      base: {
        kind: "cli",
        invokable_by: ["review-agent", "implementer"],
      },
      lint: {
        extends: "base",
        command: "lint",
      },
    };

    const result = resolveToolExtends(tools);
    expect(result.lint.invokable_by).toEqual(["review-agent", "implementer"]);
  });

  it("keeps child invokable_by when explicitly set", () => {
    const tools: Record<string, Tool> = {
      base: {
        kind: "cli",
        invokable_by: ["review-agent"],
      },
      lint: {
        extends: "base",
        command: "lint",
        invokable_by: ["implementer"],
      },
    };

    const result = resolveToolExtends(tools);
    expect(result.lint.invokable_by).toEqual(["implementer"]);
  });

  it("resolves chained extends transitively", () => {
    const tools: Record<string, Tool> = {
      root: {
        kind: "cli",
        cli_contract: "micro-contracts",
        artifact_bindings: { config: "mc-config" },
        description: "Root",
      },
      middle: {
        extends: "root",
        artifact_bindings: { "source-specs": "contracts" },
      },
      leaf: {
        extends: "middle",
        command: "generate",
      },
    };

    const result = resolveToolExtends(tools);
    expect(result.leaf.kind).toBe("cli");
    expect(result.leaf.cli_contract).toBe("micro-contracts");
    expect(result.leaf.description).toBe("Root");
    expect(result.leaf.artifact_bindings).toEqual({
      config: "mc-config",
      "source-specs": "contracts",
    });
    expect(result.leaf.command).toBe("generate");
  });

  it("detects circular extends", () => {
    const tools: Record<string, Tool> = {
      a: { extends: "b", command: "a" },
      b: { extends: "a", kind: "cli" },
    };

    expect(() => resolveToolExtends(tools)).toThrow(ToolExtendsError);
    expect(() => resolveToolExtends(tools)).toThrow(/Circular tool extends/i);
  });

  it("handles extends to non-existent base gracefully", () => {
    const tools: Record<string, Tool> = {
      orphan: {
        extends: "missing-base",
        command: "lint",
      },
    };

    expect(() => resolveToolExtends(tools)).not.toThrow();
    const result = resolveToolExtends(tools);
    expect(result.orphan.extends).toBe("missing-base");
    expect(result.orphan.command).toBe("lint");
  });
});
