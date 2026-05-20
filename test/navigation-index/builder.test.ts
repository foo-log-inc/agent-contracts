import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { DslSchema, type Dsl } from "../../src/schema/index.js";
import { buildNavigationIndex } from "../../src/navigation-index/builder.js";
import { buildEntityContext } from "../../src/renderer/renderer.js";

const speckeeperCliContract = resolve(
  import.meta.dirname,
  "../fixtures/cli-contracts/speckeeper-cli-contract.yaml",
);

function makeDsl(partial: Partial<Record<string, unknown>>): Dsl {
  return DslSchema.parse({
    version: 1,
    system: { id: "test-system", name: "Test System", default_workflow_order: ["implement"] },
    ...partial,
  });
}

describe("buildNavigationIndex", () => {
  it("builds index with basic artifact and no tools", () => {
    const dsl = makeDsl({
      artifacts: {
        "design-dir": {
          type: "source",
          path_patterns: ["design/**"],
        },
      },
    });

    const index = buildNavigationIndex(dsl);

    expect(index.version).toBe("1.0.0");
    expect(index.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(index.system).toEqual({ id: "test-system", name: "Test System" });

    const node = index.artifacts["design-dir"];
    expect(node.id).toBe("design-dir");
    expect(node.files.path_patterns).toEqual(["design/**"]);
    expect(node.files.exclude_patterns).toEqual([]);
    expect(node.operations.producers).toEqual([]);
    expect(node.operations.validators).toEqual([]);
    expect(node.operations.consumers).toEqual([]);
    expect(node.relations.source_artifacts).toEqual([]);
    expect(node.relations.derived_artifacts).toEqual([]);
    expect(node.agents.owners).toEqual([]);
    expect(node.agents.editors).toEqual([]);
    expect(node.agents.readers).toEqual([]);
  });

  it("classifies legacy model tools as producer, consumer, and validator", () => {
    const dsl = makeDsl({
      artifacts: {
        specs: { type: "source", authority: "canonical" },
        output: { type: "generated-code", authority: "generated" },
        "test-code": { type: "code", authority: "canonical" },
      },
      tools: {
        generator: {
          kind: "cli",
          invokable_by: ["builder"],
          commands: [
            {
              command: "generate",
              category: "build",
              reads: ["specs"],
              writes: ["output"],
            },
          ],
        },
        linter: {
          kind: "linter",
          invokable_by: ["reviewer"],
          commands: [
            {
              command: "lint",
              category: "lint",
              reads: ["specs"],
              writes: [],
            },
          ],
        },
        reader: {
          kind: "cli",
          invokable_by: ["reviewer"],
          commands: [
            {
              command: "inspect",
              category: "query",
              reads: ["test-code"],
              writes: [],
            },
          ],
        },
      },
    });

    const index = buildNavigationIndex(dsl);

    expect(index.artifacts.specs.operations.producers).toEqual([]);
    expect(index.artifacts.specs.operations.validators).toHaveLength(1);
    expect(index.artifacts.specs.operations.validators[0]?.tool).toBe("linter");
    expect(index.artifacts.specs.operations.consumers).toHaveLength(1);
    expect(index.artifacts.specs.operations.consumers[0]?.tool).toBe("generator");

    expect(index.artifacts.output.operations.producers).toHaveLength(1);
    expect(index.artifacts.output.operations.producers[0]?.tool).toBe("generator");

    expect(index.artifacts["test-code"].operations.consumers).toHaveLength(1);
    expect(index.artifacts["test-code"].operations.consumers[0]?.tool).toBe("reader");
  });

  it("falls back to read-only when cli-contract file is unavailable", () => {
    const dsl = makeDsl({
      artifacts: {
        "design-dir": { type: "source", authority: "canonical" },
        "speckeeper-config": { type: "config", authority: "control" },
      },
      tools: {
        base: {
          kind: "cli",
          cli_contract: "speckeeper",
          artifact_bindings: {
            "spec-source": "design-dir",
            config: "speckeeper-config",
          },
        },
        "speckeeper-lint": {
          extends: "base",
          command: "lint",
          kind: "linter",
          invokable_by: ["reviewer"],
        },
      },
    });

    const index = buildNavigationIndex(dsl);

    expect(index.artifacts["design-dir"].operations.validators).toHaveLength(1);
    expect(index.artifacts["design-dir"].operations.validators[0]).toMatchObject({
      tool: "speckeeper-lint",
      cli_contract: "speckeeper",
      command: "lint",
      slot: "spec-source",
      invokable_by: ["reviewer"],
    });

    expect(index.artifacts["speckeeper-config"].operations.validators).toHaveLength(1);
    expect(index.artifacts["speckeeper-config"].operations.validators[0]?.slot).toBe("config");
  });

  describe("cli-contract slot direction resolution", () => {
    const baseArtifacts = {
      "design-dir": { type: "source", authority: "canonical" },
      "design-models": { type: "source", authority: "canonical" },
      "output-docs": { type: "documentation", authority: "generated" },
      "workspace-cache": { type: "cache", authority: "derived" },
    };

    it("resolves lint command bindings as read from cli-contract effects", () => {
      const dsl = makeDsl({
        artifacts: baseArtifacts,
        tools: {
          base: {
            kind: "cli",
            cli_contract: speckeeperCliContract,
            artifact_bindings: {
              "spec-source": "design-dir",
              "design-models": "design-models",
            },
          },
          "speckeeper-lint": {
            extends: "base",
            command: "lint",
            kind: "linter",
            invokable_by: ["reviewer"],
          },
        },
      });

      const index = buildNavigationIndex(dsl);

      expect(index.artifacts["design-dir"].operations.producers).toEqual([]);
      expect(index.artifacts["design-dir"].operations.validators).toHaveLength(1);
      expect(index.artifacts["design-dir"].operations.validators[0]).toMatchObject({
        tool: "speckeeper-lint",
        command: "lint",
        slot: "spec-source",
      });

      expect(index.artifacts["design-models"].operations.producers).toEqual([]);
      expect(index.artifacts["design-models"].operations.validators).toHaveLength(1);
      expect(index.artifacts["design-models"].operations.validators[0]?.slot).toBe("design-models");
    });

    it("resolves build command bindings with read and write from cli-contract effects", () => {
      const dsl = makeDsl({
        artifacts: baseArtifacts,
        tools: {
          base: {
            kind: "cli",
            cli_contract: speckeeperCliContract,
            artifact_bindings: {
              "spec-source": "design-dir",
              "output-docs": "output-docs",
            },
          },
          "speckeeper-build": {
            extends: "base",
            command: "build",
            kind: "cli",
            invokable_by: ["builder"],
          },
        },
      });

      const index = buildNavigationIndex(dsl);

      const designDirConsumer = index.artifacts["design-dir"].operations.consumers.find(
        (op) => op.tool === "speckeeper-build",
      );
      expect(designDirConsumer).toMatchObject({
        tool: "speckeeper-build",
        command: "build",
        slot: "spec-source",
      });

      const outputDocsProducer = index.artifacts["output-docs"].operations.producers.find(
        (op) => op.tool === "speckeeper-build",
      );
      expect(outputDocsProducer).toMatchObject({
        tool: "speckeeper-build",
        command: "build",
        slot: "output-docs",
      });
    });

    it("treats readwrite artifactSlots direction as write when not listed in command effects", () => {
      const dsl = makeDsl({
        artifacts: baseArtifacts,
        tools: {
          "cache-sync": {
            kind: "cli",
            cli_contract: speckeeperCliContract,
            command: "sync",
            invokable_by: ["builder"],
            artifact_bindings: {
              "workspace-cache": "workspace-cache",
            },
          },
        },
      });

      const index = buildNavigationIndex(dsl);

      expect(index.artifacts["workspace-cache"].operations.producers).toHaveLength(1);
      expect(index.artifacts["workspace-cache"].operations.producers[0]).toMatchObject({
        tool: "cache-sync",
        command: "sync",
        slot: "workspace-cache",
      });
    });

    it("falls back to read when cli-contract path does not exist", () => {
      const dsl = makeDsl({
        artifacts: {
          "design-dir": { type: "source", authority: "canonical" },
        },
        tools: {
          "missing-contract": {
            kind: "linter",
            cli_contract: "nonexistent/cli-contract.yaml",
            command: "lint",
            invokable_by: ["reviewer"],
            artifact_bindings: {
              "spec-source": "design-dir",
            },
          },
        },
      });

      const index = buildNavigationIndex(dsl);

      expect(index.artifacts["design-dir"].operations.validators).toHaveLength(1);
      expect(index.artifacts["design-dir"].operations.producers).toEqual([]);
    });
  });

  it("maps agents to artifact owners, editors, and readers", () => {
    const dsl = makeDsl({
      artifacts: {
        "api-specs": { type: "source", authority: "canonical" },
      },
      agents: {
        architect: {
          role_name: "Architect",
          purpose: "Design",
          own_artifacts: ["api-specs"],
          can_read_artifacts: ["api-specs"],
          can_write_artifacts: ["api-specs"],
        },
        reviewer: {
          role_name: "Reviewer",
          purpose: "Review",
          can_read_artifacts: ["api-specs"],
          can_write_artifacts: [],
        },
      },
    });

    const index = buildNavigationIndex(dsl);
    const agents = index.artifacts["api-specs"].agents;

    expect(agents.owners).toEqual(["architect"]);
    expect(agents.editors).toEqual(["architect"]);
    expect(agents.readers).toEqual(["architect", "reviewer"]);
  });

  it("computes source and derived artifact relations from tool reads/writes", () => {
    const dsl = makeDsl({
      artifacts: {
        "api-specs": { type: "source", authority: "canonical" },
        "api-contracts": { type: "generated-code", authority: "generated" },
      },
      tools: {
        pipeline: {
          kind: "cli",
          invokable_by: ["maintainer"],
          commands: [
            {
              command: "pipeline",
              category: "build",
              reads: ["api-specs"],
              writes: ["api-contracts"],
            },
          ],
        },
      },
    });

    const index = buildNavigationIndex(dsl);

    expect(index.artifacts["api-specs"].relations.derived_artifacts).toEqual(["api-contracts"]);
    expect(index.artifacts["api-contracts"].relations.source_artifacts).toEqual(["api-specs"]);
  });

  it("generates validate routes for validator operations", () => {
    const dsl = makeDsl({
      artifacts: {
        specs: { type: "source", authority: "canonical" },
      },
      tools: {
        linter: {
          kind: "linter",
          invokable_by: ["reviewer"],
          commands: [
            {
              command: "lint",
              category: "lint",
              reads: ["specs"],
              writes: [],
            },
          ],
        },
      },
    });

    const index = buildNavigationIndex(dsl);
    const routes = index.artifacts.specs.routes.validate;

    expect(routes).toHaveLength(1);
    expect(routes?.[0]).toEqual({
      purpose: "validate",
      steps: [
        {
          type: "run_operation",
          operation: "linter",
          candidate_agents: ["reviewer"],
        },
      ],
    });
  });

  it("generates regenerate routes for generated artifacts with producers", () => {
    const dsl = makeDsl({
      artifacts: {
        "api-specs": { type: "source", authority: "canonical" },
        "api-contracts": { type: "generated-code", authority: "generated" },
      },
      agents: {
        designer: {
          role_name: "Designer",
          purpose: "Design",
          can_read_artifacts: ["api-specs"],
          can_write_artifacts: ["api-specs"],
        },
        maintainer: {
          role_name: "Maintainer",
          purpose: "Maintain",
          can_execute_tools: ["pipeline"],
        },
      },
      tools: {
        pipeline: {
          kind: "cli",
          invokable_by: ["maintainer"],
          commands: [
            {
              command: "pipeline",
              category: "build",
              reads: ["api-specs"],
              writes: ["api-contracts"],
            },
          ],
        },
      },
    });

    const index = buildNavigationIndex(dsl);
    const routes = index.artifacts["api-contracts"].routes.regenerate;

    expect(routes).toHaveLength(1);
    expect(routes?.[0]?.purpose).toBe("regenerate");
    expect(routes?.[0]?.steps).toEqual([
      {
        type: "edit_artifact",
        artifact: "api-specs",
        candidate_agents: ["designer"],
      },
      {
        type: "run_operation",
        operation: "pipeline",
        candidate_agents: ["maintainer"],
      },
    ]);
  });

  it("generates update routes for canonical artifacts with edit and validate steps", () => {
    const dsl = makeDsl({
      artifacts: {
        specs: { type: "source", authority: "canonical" },
      },
      agents: {
        editor: {
          role_name: "Editor",
          purpose: "Edit",
          can_read_artifacts: ["specs"],
          can_write_artifacts: ["specs"],
        },
        reviewer: {
          role_name: "Reviewer",
          purpose: "Review",
          can_execute_tools: ["linter"],
        },
      },
      tools: {
        linter: {
          kind: "linter",
          invokable_by: ["reviewer"],
          commands: [
            {
              command: "lint",
              category: "lint",
              reads: ["specs"],
              writes: [],
            },
          ],
        },
      },
    });

    const index = buildNavigationIndex(dsl);
    const routes = index.artifacts.specs.routes.update;

    expect(routes).toHaveLength(1);
    expect(routes?.[0]?.purpose).toBe("update");
    expect(routes?.[0]?.steps).toEqual([
      {
        type: "edit_artifact",
        artifact: "specs",
        candidate_agents: ["editor"],
      },
      {
        type: "run_operation",
        operation: "linter",
        candidate_agents: ["reviewer"],
      },
    ]);
  });

  it("applies property defaults when artifact fields are omitted", () => {
    const dsl = makeDsl({
      artifacts: {
        docs: { type: "documentation" },
      },
    });

    const index = buildNavigationIndex(dsl);
    expect(index.artifacts.docs.properties).toEqual({
      type: "documentation",
      authority: "canonical",
      manual_edit: "allowed",
      change_control: "none",
    });
  });

  it("represents multiple tools operating on the same artifact", () => {
    const dsl = makeDsl({
      artifacts: {
        specs: { type: "source", authority: "canonical" },
      },
      tools: {
        linter: {
          kind: "linter",
          invokable_by: ["reviewer-a"],
          commands: [
            { command: "lint", category: "lint", reads: ["specs"], writes: [] },
          ],
        },
        checker: {
          kind: "checker",
          invokable_by: ["reviewer-b"],
          commands: [
            { command: "check", category: "check", reads: ["specs"], writes: [] },
          ],
        },
        reader: {
          kind: "cli",
          invokable_by: ["reader"],
          commands: [
            { command: "inspect", category: "query", reads: ["specs"], writes: [] },
          ],
        },
      },
    });

    const index = buildNavigationIndex(dsl);
    const ops = index.artifacts.specs.operations;

    expect(ops.validators.map((op) => op.tool).sort()).toEqual(["checker", "linter"]);
    expect(ops.consumers.map((op) => op.tool)).toEqual(["reader"]);
    expect(ops.producers).toEqual([]);
  });
});

describe("buildEntityContext with navigation-index", () => {
  it("returns a ProjectNavigationIndex-shaped object", () => {
    const dsl = makeDsl({
      artifacts: {
        specs: { type: "source", authority: "canonical" },
      },
    });

    const ctx = buildEntityContext(dsl, "navigation-index", "");

    expect(ctx.version).toBe("1.0.0");
    expect(ctx.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(ctx.system).toEqual({ id: "test-system", name: "Test System" });
    expect(ctx.artifacts).toBeDefined();
    expect((ctx.artifacts as Record<string, unknown>).specs).toMatchObject({
      id: "specs",
    });
  });
});
