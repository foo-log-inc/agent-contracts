/**
 * Tests for Feature #133 — declarative event_mapping + lookup generation.
 *
 * Covers:
 *  - SoftwareBindingSchema accepts event_mapping (schema validation)
 *  - builtin:event-mapping  → produces event-mapping.json
 *  - builtin:task-patterns  → produces task-patterns.json
 *  - builtin:artifact-lookup → produces artifact-lookup.json
 *  - builtin:recorder       → produces a recorder shell script
 *  - builtin:git-hook        → produces a git-hook shell script
 *  - Unknown builtin names still produce info diagnostics (backward compat)
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { LoadedBinding } from "../../src/config/binding-loader.js";
import type { ResolvedConfig } from "../../src/config/types.js";
import { generateGuardrails } from "../../src/guardrail-generator/generator.js";
import {
  DslSchema,
  SoftwareBindingSchema,
  type Dsl,
  type SoftwareBinding,
} from "../../src/schema/index.js";

// ── helpers ──────────────────────────────────────────────────────────────────

const createdDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    createdDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});

async function newTmpDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "agc-em-"));
  createdDirs.push(dir);
  return dir;
}

function minimalDsl(overrides: Partial<Record<string, unknown>> = {}): Dsl {
  return DslSchema.parse({
    version: 1,
    system: { id: "sys", name: "System", default_workflow_order: [] },
    guardrails: { gr1: { description: "g1", scope: {} } },
    guardrail_policies: {
      default: {
        description: "Default",
        rules: [{ guardrail: "gr1", severity: "mandatory", action: "warn" }],
      },
    },
    ...overrides,
  });
}

function dslWithEntities(): Dsl {
  return minimalDsl({
    agents: {
      implementer: { role_name: "Implementer", purpose: "Implement" },
      reviewer: { role_name: "Reviewer", purpose: "Review" },
    },
    tasks: {
      "feat-task": {
        description: "Feature task",
        target_agent: "implementer",
        allowed_from_agents: [],
        workflow: "dev",
        input_artifacts: [],
        invocation_handoff: "h",
        result_handoff: "h",
      },
      "review-task": {
        description: "Review task",
        target_agent: "reviewer",
        allowed_from_agents: [],
        workflow: "dev",
        input_artifacts: [],
        invocation_handoff: "h",
        result_handoff: "h",
      },
    },
    artifacts: {
      "source-code": {
        type: "file",
        description: "Source files",
        owner: "implementer",
        producers: ["implementer"],
        consumers: ["reviewer"],
        editors: [],
        states: ["draft"],
        path_patterns: ["src/**/*.ts", "src/**/*.js"],
        exclude_patterns: ["**/*.d.ts"],
      },
      "no-patterns": {
        // artifact with no path_patterns — should not appear in artifact-lookup
        type: "document",
        description: "Design doc",
        owner: "implementer",
        producers: ["implementer"],
        consumers: [],
        editors: [],
        states: ["draft"],
      },
    },
    handoff_types: {
      h: { version: 1, schema: { type: "object", properties: {} } },
    },
    workflow: { dev: { description: "Dev", steps: [] } },
  });
}

function baseConfig(configDir: string): ResolvedConfig {
  return {
    dsl: "dsl.yaml",
    renders: [],
    configDir,
    bindings: [],
    paths: { out: join(configDir, "out") },
    activeGuardrailPolicy: "default",
  };
}

function lbWithEventMapping(
  configDir: string,
  outputs: NonNullable<SoftwareBinding["outputs"]>,
  eventMapping?: SoftwareBinding["event_mapping"],
): LoadedBinding {
  return {
    filePath: join(configDir, "b.yaml"),
    binding: {
      software: "app",
      version: 1,
      guardrail_impl: { gr1: { checks: [{ message: "c" }] } },
      outputs,
      event_mapping: eventMapping,
    },
  };
}

// ── Schema validation ─────────────────────────────────────────────────────────

describe("SoftwareBindingSchema — event_mapping field (Feature #133)", () => {
  it("accepts a binding without event_mapping (backward compat)", () => {
    const result = SoftwareBindingSchema.safeParse({
      software: "app",
      version: 1,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a binding with a valid event_mapping", () => {
    const result = SoftwareBindingSchema.safeParse({
      software: "app",
      version: 1,
      event_mapping: {
        "pre-commit": {
          spans: [
            { axis: "trace", name: "commit-span", lifecycle: "start" },
          ],
          links: [
            { type: "follows_from", from: "commit-span", to: "push-span" },
          ],
        },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.event_mapping?.["pre-commit"]?.spans).toHaveLength(1);
    }
  });

  it("accepts spans with all optional fields", () => {
    const result = SoftwareBindingSchema.safeParse({
      software: "app",
      version: 1,
      event_mapping: {
        "task:start": {
          spans: [
            {
              axis: "trace",
              name: "task-span",
              lifecycle: "start",
              condition: "{{task.id}} != null",
              each: "{{#each tasks}}{{@key}}{{/each}}",
              attributes: {
                "task.id": "{{task.id}}",
                "agent.id": "{{agent.id}}",
              },
            },
          ],
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts links with all optional fields", () => {
    const result = SoftwareBindingSchema.safeParse({
      software: "app",
      version: 1,
      event_mapping: {
        "task:end": {
          links: [
            {
              type: "child_of",
              from: "task-span",
              to: "workflow-span",
              condition: "{{status}} == success",
              attributes: { "result.status": "{{status}}" },
            },
          ],
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("passes through extra fields on event_mapping entries (passthrough)", () => {
    const result = SoftwareBindingSchema.safeParse({
      software: "app",
      version: 1,
      event_mapping: {
        "custom:event": {
          spans: [],
          links: [],
          "x-custom-metadata": { note: "extra" },
        },
      },
    });
    expect(result.success).toBe(true);
  });
});

// ── builtin:event-mapping ─────────────────────────────────────────────────────

describe("builtin:event-mapping output generation", () => {
  it("generates event-mapping.json from binding event_mapping", async () => {
    const configDir = await newTmpDir();
    const dsl = minimalDsl();
    const config = baseConfig(configDir);

    const eventMapping: SoftwareBinding["event_mapping"] = {
      "pre-commit": {
        spans: [{ axis: "trace", name: "commit", lifecycle: "point" }],
        links: [],
      },
      "task:start": {
        spans: [{ axis: "log", name: "task-log", lifecycle: "start" }],
      },
    };

    const result = await generateGuardrails({
      dsl,
      config,
      loadedBindings: [
        lbWithEventMapping(
          configDir,
          { "event-mapping": { target: "{out}/event-mapping.json", template: "builtin:event-mapping" } },
          eventMapping,
        ),
      ],
    });

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.outputFiles).toHaveLength(1);

    const content = JSON.parse(await readFile(join(configDir, "out", "event-mapping.json"), "utf8"));
    expect(Object.keys(content)).toEqual(expect.arrayContaining(["pre-commit", "task:start"]));
    expect(content["pre-commit"].spans).toHaveLength(1);
    expect(content["pre-commit"].spans[0].name).toBe("commit");
  });

  it("produces empty object when binding has no event_mapping", async () => {
    const configDir = await newTmpDir();
    const dsl = minimalDsl();
    const config = baseConfig(configDir);

    await generateGuardrails({
      dsl,
      config,
      loadedBindings: [
        lbWithEventMapping(
          configDir,
          { "event-mapping": { target: "{out}/event-mapping.json", template: "builtin:event-mapping" } },
          // no event_mapping
        ),
      ],
    });

    const content = JSON.parse(await readFile(join(configDir, "out", "event-mapping.json"), "utf8"));
    expect(content).toEqual({});
  });
});

// ── builtin:task-patterns ─────────────────────────────────────────────────────

describe("builtin:task-patterns output generation", () => {
  it("maps each task to its agent and workflow with structured tags", async () => {
    const configDir = await newTmpDir();
    const dsl = dslWithEntities();
    const config = baseConfig(configDir);

    const result = await generateGuardrails({
      dsl,
      config,
      loadedBindings: [
        lbWithEventMapping(configDir, {
          "task-patterns": {
            target: "{out}/task-patterns.json",
            template: "builtin:task-patterns",
          },
        }),
      ],
    });

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const content = JSON.parse(await readFile(join(configDir, "out", "task-patterns.json"), "utf8"));

    expect(Object.keys(content)).toEqual(expect.arrayContaining(["feat-task", "review-task"]));
    expect(content["feat-task"].agent).toBe("implementer");
    expect(content["feat-task"].workflow).toBe("dev");
    expect(content["feat-task"].tags["task.id"]).toBe("feat-task");
    expect(content["feat-task"].tags["task.workflow"]).toBe("dev");
    expect(content["feat-task"].tags["agent.id"]).toBe("implementer");
    expect(content["feat-task"].tags["agent.role"]).toBe("Implementer");

    expect(content["review-task"].agent).toBe("reviewer");
    expect(content["review-task"].tags["agent.role"]).toBe("Reviewer");
  });

  it("handles DSL with no tasks", async () => {
    const configDir = await newTmpDir();
    const dsl = minimalDsl(); // no tasks
    const config = baseConfig(configDir);

    await generateGuardrails({
      dsl,
      config,
      loadedBindings: [
        lbWithEventMapping(configDir, {
          tp: { target: "{out}/task-patterns.json", template: "builtin:task-patterns" },
        }),
      ],
    });

    const content = JSON.parse(await readFile(join(configDir, "out", "task-patterns.json"), "utf8"));
    expect(content).toEqual({});
  });
});

// ── builtin:artifact-lookup ───────────────────────────────────────────────────

describe("builtin:artifact-lookup output generation", () => {
  it("derives path globs from artifact path_patterns declarations", async () => {
    const configDir = await newTmpDir();
    const dsl = dslWithEntities();
    const config = baseConfig(configDir);

    const result = await generateGuardrails({
      dsl,
      config,
      loadedBindings: [
        lbWithEventMapping(configDir, {
          "artifact-lookup": {
            target: "{out}/artifact-lookup.json",
            template: "builtin:artifact-lookup",
          },
        }),
      ],
    });

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const content = JSON.parse(
      await readFile(join(configDir, "out", "artifact-lookup.json"), "utf8"),
    );

    // Only artifacts with path_patterns should be included
    expect(Object.keys(content)).toContain("source-code");
    expect(Object.keys(content)).not.toContain("no-patterns");

    expect(content["source-code"].path_patterns).toEqual(["src/**/*.ts", "src/**/*.js"]);
    expect(content["source-code"].exclude_patterns).toEqual(["**/*.d.ts"]);
  });

  it("omits artifacts that have no path_patterns (non-file artifacts)", async () => {
    const configDir = await newTmpDir();
    const dsl = dslWithEntities();
    const config = baseConfig(configDir);

    await generateGuardrails({
      dsl,
      config,
      loadedBindings: [
        lbWithEventMapping(configDir, {
          al: { target: "{out}/al.json", template: "builtin:artifact-lookup" },
        }),
      ],
    });

    const content = JSON.parse(await readFile(join(configDir, "out", "al.json"), "utf8"));
    expect(Object.keys(content)).not.toContain("no-patterns");
  });

  it("produces empty object when no artifact has path_patterns", async () => {
    const configDir = await newTmpDir();
    const dsl = minimalDsl({ artifacts: { "doc": { type: "document", producers: [], consumers: [], editors: [], states: [] } } });
    const config = baseConfig(configDir);

    await generateGuardrails({
      dsl,
      config,
      loadedBindings: [
        lbWithEventMapping(configDir, {
          al: { target: "{out}/al.json", template: "builtin:artifact-lookup" },
        }),
      ],
    });

    const content = JSON.parse(await readFile(join(configDir, "out", "al.json"), "utf8"));
    expect(content).toEqual({});
  });
});

// ── builtin:recorder ──────────────────────────────────────────────────────────

describe("builtin:recorder output generation", () => {
  it("generates a recorder shell script listing event names", async () => {
    const configDir = await newTmpDir();
    const dsl = minimalDsl();
    const config = baseConfig(configDir);

    const result = await generateGuardrails({
      dsl,
      config,
      loadedBindings: [
        lbWithEventMapping(
          configDir,
          {
            recorder: {
              target: "{out}/recorder.sh",
              template: "builtin:recorder",
              executable: true,
            },
          },
          {
            "pre-commit": { spans: [] },
            "task:start": { spans: [] },
          },
        ),
      ],
    });

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const content = await readFile(join(configDir, "out", "recorder.sh"), "utf8");
    expect(content).toContain("record_event");
    expect(content).toContain("pre-commit");
    expect(content).toContain("task:start");
  });
});

// ── builtin:git-hook ──────────────────────────────────────────────────────────

describe("builtin:git-hook output generation", () => {
  it("generates a git hook script for promotion events", async () => {
    const configDir = await newTmpDir();
    const dsl = minimalDsl();
    const config = baseConfig(configDir);

    const result = await generateGuardrails({
      dsl,
      config,
      loadedBindings: [
        lbWithEventMapping(
          configDir,
          {
            hook: {
              target: "{out}/pre-commit",
              template: "builtin:git-hook",
              executable: true,
            },
          },
          {
            "git:pre-commit": { spans: [] },
            "task:start": { spans: [] }, // not a promotion event — should not appear
          },
        ),
      ],
    });

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const content = await readFile(join(configDir, "out", "pre-commit"), "utf8");
    expect(content).toContain("git:pre-commit");
    expect(content).toContain("exit 0");
    // task:start is not a promotion event
    expect(content).not.toContain("task:start");
  });
});

// ── unknown builtin — backward compat ────────────────────────────────────────

describe("unknown builtin templates still emit info diagnostic", () => {
  it("produces info diagnostic and skips unknown builtin", async () => {
    const configDir = await newTmpDir();
    const dsl = minimalDsl();
    const config = baseConfig(configDir);

    const result = await generateGuardrails({
      dsl,
      config,
      loadedBindings: [
        lbWithEventMapping(configDir, {
          out: { target: "{out}/x.json", template: "builtin:future-feature" },
        }),
      ],
    });

    expect(result.outputFiles).toEqual([]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "info",
        message: expect.stringContaining("builtin:future-feature"),
      }),
    );
  });
});
