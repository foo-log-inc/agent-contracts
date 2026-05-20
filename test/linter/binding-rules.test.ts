import { resolve, join } from "node:path";
import { describe, it, expect } from "vitest";
import { DslSchema, type Dsl } from "../../src/schema/index.js";
import { bindingCompletenessRule } from "../../src/linter/rules/binding-completeness.js";
import { bindingDirectionMatchRule } from "../../src/linter/rules/binding-direction-match.js";
import { slotDeclarationExistsRule } from "../../src/linter/rules/slot-declaration-exists.js";
import { configPathConsistencyRule } from "../../src/linter/rules/config-path-consistency.js";

const fixturesDir = resolve(import.meta.dirname, "../fixtures");
const speckeeperCliContract = join(fixturesDir, "cli-contracts/speckeeper-cli-contract.yaml");

function makeDsl(partial: Partial<Record<string, unknown>>): Dsl {
  return DslSchema.parse({
    version: 1,
    system: { id: "s", name: "S", default_workflow_order: ["implement"] },
    ...partial,
  });
}

describe("bindingCompletenessRule", () => {
  it("warns when command effects reference slots missing from artifact_bindings", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P" } },
      artifacts: {
        spec: { type: "doc", owner: "a1", producers: ["a1"], editors: ["a1"], consumers: ["a1"], states: ["draft"] },
        output: { type: "doc", owner: "a1", producers: ["a1"], editors: ["a1"], consumers: ["a1"], states: ["draft"] },
      },
      tools: {
        speckeeper: {
          kind: "cli",
          invokable_by: ["a1"],
          cli_contract: speckeeperCliContract,
          command: "build",
          artifact_bindings: {
            "spec-source": "spec",
          },
        },
      },
    });

    const diags = bindingCompletenessRule.run(dsl);
    expect(diags.length).toBe(1);
    expect(diags[0].severity).toBe("warning");
    expect(diags[0].ruleId).toBe("binding-completeness");
    expect(diags[0].message).toContain("output-docs");
  });

  it("passes when artifact_bindings cover all referenced slots", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P" } },
      artifacts: {
        spec: { type: "doc", owner: "a1", producers: ["a1"], editors: ["a1"], consumers: ["a1"], states: ["draft"] },
        output: { type: "doc", owner: "a1", producers: ["a1"], editors: ["a1"], consumers: ["a1"], states: ["draft"] },
      },
      tools: {
        speckeeper: {
          kind: "cli",
          invokable_by: ["a1"],
          cli_contract: speckeeperCliContract,
          command: "build",
          artifact_bindings: {
            "spec-source": "spec",
            "output-docs": "output",
          },
        },
      },
    });

    const diags = bindingCompletenessRule.run(dsl);
    expect(diags).toHaveLength(0);
  });

  it("skips when cli-contract file cannot be loaded", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P" } },
      tools: {
        missing: {
          kind: "cli",
          invokable_by: ["a1"],
          cli_contract: "nonexistent-tool/cli-contract.yaml",
          command: "build",
          artifact_bindings: { slot: "art1" },
        },
      },
    });

    const diags = bindingCompletenessRule.run(dsl);
    expect(diags).toHaveLength(0);
  });
});

describe("bindingDirectionMatchRule", () => {
  it("warns when invoking agent lacks can_write_artifacts for a write slot", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P", can_write_artifacts: [] } },
      artifacts: {
        spec: { type: "doc", owner: "a1", producers: ["a1"], editors: ["a1"], consumers: ["a1"], states: ["draft"] },
        output: { type: "doc", owner: "a1", producers: ["a1"], editors: ["a1"], consumers: ["a1"], states: ["draft"] },
      },
      tools: {
        speckeeper: {
          kind: "cli",
          invokable_by: ["a1"],
          cli_contract: speckeeperCliContract,
          command: "build",
          artifact_bindings: {
            "spec-source": "spec",
            "output-docs": "output",
          },
        },
      },
    });

    const diags = bindingDirectionMatchRule.run(dsl);
    expect(diags.length).toBe(1);
    expect(diags[0].severity).toBe("warning");
    expect(diags[0].ruleId).toBe("binding-direction-match");
    expect(diags[0].message).toContain("output");
    expect(diags[0].message).toContain("a1");
  });

  it("passes when invoking agent has can_write_artifacts for write slot", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P", can_write_artifacts: ["output"] } },
      artifacts: {
        spec: { type: "doc", owner: "a1", producers: ["a1"], editors: ["a1"], consumers: ["a1"], states: ["draft"] },
        output: { type: "doc", owner: "a1", producers: ["a1"], editors: ["a1"], consumers: ["a1"], states: ["draft"] },
      },
      tools: {
        speckeeper: {
          kind: "cli",
          invokable_by: ["a1"],
          cli_contract: speckeeperCliContract,
          command: "build",
          artifact_bindings: {
            "spec-source": "spec",
            "output-docs": "output",
          },
        },
      },
    });

    const diags = bindingDirectionMatchRule.run(dsl);
    expect(diags).toHaveLength(0);
  });

  it("passes when invoking agent owns the write artifact via own_artifacts", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P", own_artifacts: ["output"] } },
      artifacts: {
        spec: { type: "doc", owner: "a1", producers: ["a1"], editors: ["a1"], consumers: ["a1"], states: ["draft"] },
        output: { type: "doc", owner: "a1", producers: ["a1"], editors: ["a1"], consumers: ["a1"], states: ["draft"] },
      },
      tools: {
        speckeeper: {
          kind: "cli",
          invokable_by: ["a1"],
          cli_contract: speckeeperCliContract,
          command: "build",
          artifact_bindings: {
            "spec-source": "spec",
            "output-docs": "output",
          },
        },
      },
    });

    const diags = bindingDirectionMatchRule.run(dsl);
    expect(diags).toHaveLength(0);
  });

  it("skips when cli-contract file cannot be loaded", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P" } },
      tools: {
        missing: {
          kind: "cli",
          invokable_by: ["a1"],
          cli_contract: "nonexistent-tool/cli-contract.yaml",
          command: "build",
          artifact_bindings: { "output-docs": "output" },
        },
      },
    });

    const diags = bindingDirectionMatchRule.run(dsl);
    expect(diags).toHaveLength(0);
  });
});

describe("slotDeclarationExistsRule", () => {
  it("warns when artifact_bindings key is not in cli-contract artifactSlots", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P" } },
      artifacts: {
        spec: { type: "doc", owner: "a1", producers: ["a1"], editors: ["a1"], consumers: ["a1"], states: ["draft"] },
      },
      tools: {
        speckeeper: {
          kind: "cli",
          invokable_by: ["a1"],
          cli_contract: speckeeperCliContract,
          command: "lint",
          artifact_bindings: {
            "spec-source": "spec",
            "unknown-slot": "spec",
          },
        },
      },
    });

    const diags = slotDeclarationExistsRule.run(dsl);
    expect(diags.length).toBe(1);
    expect(diags[0].severity).toBe("warning");
    expect(diags[0].ruleId).toBe("slot-declaration-exists");
    expect(diags[0].message).toContain("unknown-slot");
  });

  it("passes when all artifact_bindings keys exist in artifactSlots", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P" } },
      artifacts: {
        spec: { type: "doc", owner: "a1", producers: ["a1"], editors: ["a1"], consumers: ["a1"], states: ["draft"] },
        design: { type: "doc", owner: "a1", producers: ["a1"], editors: ["a1"], consumers: ["a1"], states: ["draft"] },
      },
      tools: {
        speckeeper: {
          kind: "cli",
          invokable_by: ["a1"],
          cli_contract: speckeeperCliContract,
          command: "lint",
          artifact_bindings: {
            "spec-source": "spec",
            "design-models": "design",
          },
        },
      },
    });

    const diags = slotDeclarationExistsRule.run(dsl);
    expect(diags).toHaveLength(0);
  });

  it("skips when cli-contract file cannot be loaded", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P" } },
      tools: {
        missing: {
          kind: "cli",
          invokable_by: ["a1"],
          cli_contract: "nonexistent-tool/cli-contract.yaml",
          artifact_bindings: { "unknown-slot": "spec" },
        },
      },
    });

    const diags = slotDeclarationExistsRule.run(dsl);
    expect(diags).toHaveLength(0);
  });
});

describe("configPathConsistencyRule", () => {
  it("emits info when control artifact has no path_patterns", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P" } },
      artifacts: {
        config: {
          type: "config",
          authority: "control",
          owner: "a1",
          producers: ["a1"],
          editors: ["a1"],
          consumers: ["a1"],
          states: ["draft"],
        },
      },
      tools: {
        t1: {
          kind: "cli",
          invokable_by: ["a1"],
          artifact_bindings: {
            "config-slot": "config",
          },
        },
      },
    });

    const diags = configPathConsistencyRule.run(dsl);
    expect(diags.length).toBe(1);
    expect(diags[0].severity).toBe("info");
    expect(diags[0].ruleId).toBe("config-path-consistency");
    expect(diags[0].message).toContain("config");
    expect(diags[0].message).toContain("path_patterns");
  });

  it("passes when control artifact has path_patterns", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P" } },
      artifacts: {
        config: {
          type: "config",
          authority: "control",
          path_patterns: ["**/*.yaml"],
          owner: "a1",
          producers: ["a1"],
          editors: ["a1"],
          consumers: ["a1"],
          states: ["draft"],
        },
      },
      tools: {
        t1: {
          kind: "cli",
          invokable_by: ["a1"],
          artifact_bindings: {
            "config-slot": "config",
          },
        },
      },
    });

    const diags = configPathConsistencyRule.run(dsl);
    expect(diags).toHaveLength(0);
  });
});
