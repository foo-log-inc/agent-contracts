/**
 * Tests for Feature #132 — format-aware binding output patch.
 *
 * Covers:
 *  - section_append: insert a new marked block (first run)
 *  - section_append: replace an existing marked block (idempotency)
 *  - section_append: fallback to simple append when no markers present
 *  - array_append strategy (renamed from "append")
 *  - Format inference from template / target file extension
 *  - bash format treated the same as text for text-based ops
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { LoadedBinding } from "../../src/config/binding-loader.js";
import type { ResolvedConfig } from "../../src/config/types.js";
import { generateGuardrails } from "../../src/guardrail-generator/generator.js";
import { DslSchema, type Dsl, type SoftwareBinding } from "../../src/schema/index.js";

// ── helpers ──────────────────────────────────────────────────────────────────

const createdDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    createdDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});

async function newTmpDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "agc-fp-"));
  createdDirs.push(dir);
  return dir;
}

function minimalDsl(): Dsl {
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

function lb(
  configDir: string,
  outputs: NonNullable<SoftwareBinding["outputs"]>,
): LoadedBinding {
  return {
    filePath: join(configDir, "b.yaml"),
    binding: {
      software: "app",
      version: 1,
      guardrail_impl: { gr1: { checks: [{ message: "c" }] } },
      outputs,
    },
  };
}

// ── section_append ────────────────────────────────────────────────────────────

describe("section_append — insert new block", () => {
  it("appends a marked block when target does not exist yet", async () => {
    const configDir = await newTmpDir();
    const dsl = minimalDsl();
    const config = baseConfig(configDir);

    const block = "# BEGIN agent-contracts:rules\nrule1\nrule2\n# END agent-contracts:rules\n";

    const result = await generateGuardrails({
      dsl,
      config,
      loadedBindings: [
        lb(configDir, {
          rules: {
            target: "{out}/rules.sh",
            mode: "patch",
            format: "bash",
            patch_strategy: "section_append",
            inline_template: block,
          },
        }),
      ],
    });

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const content = await readFile(join(configDir, "out", "rules.sh"), "utf8");
    expect(content).toContain("# BEGIN agent-contracts:rules");
    expect(content).toContain("rule1");
    expect(content).toContain("rule2");
    expect(content).toContain("# END agent-contracts:rules");
  });

  it("appends a marked block after existing content", async () => {
    const configDir = await newTmpDir();
    const dsl = minimalDsl();
    const config = baseConfig(configDir);

    const existing = "#!/bin/sh\n# preamble\n";
    const outDir = join(configDir, "out");
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, "hook.sh"), existing);

    const block = "# BEGIN agent-contracts:section\nnew content\n# END agent-contracts:section\n";

    await generateGuardrails({
      dsl,
      config,
      loadedBindings: [
        lb(configDir, {
          hook: {
            target: "{out}/hook.sh",
            mode: "patch",
            format: "bash",
            patch_strategy: "section_append",
            inline_template: block,
          },
        }),
      ],
    });

    const content = await readFile(join(outDir, "hook.sh"), "utf8");
    expect(content.startsWith("#!/bin/sh\n# preamble\n")).toBe(true);
    expect(content).toContain("# BEGIN agent-contracts:section");
    expect(content).toContain("new content");
    expect(content).toContain("# END agent-contracts:section");
  });
});

describe("section_append — replace existing block (idempotency)", () => {
  it("replaces an existing BEGIN/END block in place", async () => {
    const configDir = await newTmpDir();
    const dsl = minimalDsl();
    const config = baseConfig(configDir);

    const outDir = join(configDir, "out");
    await mkdir(outDir, { recursive: true });
    const before = [
      "#!/bin/sh",
      "# other stuff",
      "# BEGIN agent-contracts:rules",
      "old rule",
      "# END agent-contracts:rules",
      "# trailing",
      "",
    ].join("\n");
    await writeFile(join(outDir, "hook.sh"), before);

    const block = "# BEGIN agent-contracts:rules\nnew rule\n# END agent-contracts:rules\n";

    await generateGuardrails({
      dsl,
      config,
      loadedBindings: [
        lb(configDir, {
          rules: {
            target: "{out}/hook.sh",
            mode: "patch",
            format: "bash",
            patch_strategy: "section_append",
            inline_template: block,
          },
        }),
      ],
    });

    const after = await readFile(join(outDir, "hook.sh"), "utf8");
    expect(after).toContain("new rule");
    expect(after).not.toContain("old rule");
    // Content outside the block is preserved
    expect(after).toContain("# other stuff");
    expect(after).toContain("# trailing");
  });

  it("is idempotent — running twice yields identical output", async () => {
    const configDir = await newTmpDir();
    const dsl = minimalDsl();
    const config = baseConfig(configDir);

    const block = "# BEGIN agent-contracts:idempotent\nstable content\n# END agent-contracts:idempotent\n";

    const run = () =>
      generateGuardrails({
        dsl,
        config,
        loadedBindings: [
          lb(configDir, {
            out: {
              target: "{out}/idempotent.sh",
              mode: "patch",
              format: "bash",
              patch_strategy: "section_append",
              inline_template: block,
            },
          }),
        ],
      });

    await run();
    const first = await readFile(join(configDir, "out", "idempotent.sh"), "utf8");

    await run();
    const second = await readFile(join(configDir, "out", "idempotent.sh"), "utf8");

    expect(second).toBe(first);
    // Only one occurrence of the block
    expect(second.split("# BEGIN agent-contracts:idempotent").length - 1).toBe(1);
  });

  it("section_append without markers falls back to plain append", async () => {
    const configDir = await newTmpDir();
    const dsl = minimalDsl();
    const config = baseConfig(configDir);

    const outDir = join(configDir, "out");
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, "log.txt"), "line1\n");

    await generateGuardrails({
      dsl,
      config,
      loadedBindings: [
        lb(configDir, {
          log: {
            target: "{out}/log.txt",
            mode: "patch",
            format: "text",
            patch_strategy: "section_append",
            inline_template: "line2\n",
          },
        }),
      ],
    });

    const content = await readFile(join(outDir, "log.txt"), "utf8");
    expect(content).toBe("line1\nline2\n");
  });
});

// ── array_append ──────────────────────────────────────────────────────────────

describe("array_append strategy (Feature #132)", () => {
  it("appends JSON array elements", async () => {
    const configDir = await newTmpDir();
    const dsl = minimalDsl();
    const config = baseConfig(configDir);

    const outDir = join(configDir, "out");
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, "items.json"), JSON.stringify(["a", "b"], null, 2) + "\n");

    await generateGuardrails({
      dsl,
      config,
      loadedBindings: [
        lb(configDir, {
          items: {
            target: "{out}/items.json",
            mode: "patch",
            format: "json",
            patch_strategy: "array_append",
            inline_template: '["c", "d"]',
          },
        }),
      ],
    });

    const body = JSON.parse(await readFile(join(outDir, "items.json"), "utf8"));
    expect(body).toEqual(["a", "b", "c", "d"]);
  });

  it("deduplicates by array_merge_key (idempotent)", async () => {
    const configDir = await newTmpDir();
    const dsl = minimalDsl();
    const config = baseConfig(configDir);

    const outDir = join(configDir, "out");
    await mkdir(outDir, { recursive: true });
    await writeFile(
      join(outDir, "hooks.json"),
      JSON.stringify([{ id: "a", cmd: "old" }, { id: "b", cmd: "keep" }], null, 2) + "\n",
    );

    const run = () =>
      generateGuardrails({
        dsl,
        config,
        loadedBindings: [
          lb(configDir, {
            hooks: {
              target: "{out}/hooks.json",
              mode: "patch",
              format: "json",
              patch_strategy: "array_append",
              array_merge_key: "id",
              inline_template: '[{"id":"a","cmd":"updated"},{"id":"c","cmd":"new"}]',
            },
          }),
        ],
      });

    await run();
    const first = JSON.parse(await readFile(join(outDir, "hooks.json"), "utf8"));
    expect(first).toHaveLength(3);
    expect(first[0]).toEqual({ id: "a", cmd: "updated" });
    expect(first[1]).toEqual({ id: "b", cmd: "keep" });
    expect(first[2]).toEqual({ id: "c", cmd: "new" });

    // Second run — idempotent
    await run();
    const second = JSON.parse(await readFile(join(outDir, "hooks.json"), "utf8"));
    expect(second).toHaveLength(3);
    expect(second[0]).toEqual({ id: "a", cmd: "updated" });
  });
});

// ── format inference ──────────────────────────────────────────────────────────

describe("format inference from template / target extension (Feature #132)", () => {
  it("infers json format when target ends with .json", async () => {
    const configDir = await newTmpDir();
    const dsl = minimalDsl();
    const config = baseConfig(configDir);

    const outDir = join(configDir, "out");
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, "cfg.json"), JSON.stringify({ a: 1 }, null, 2) + "\n");

    await generateGuardrails({
      dsl,
      config,
      loadedBindings: [
        lb(configDir, {
          cfg: {
            target: "{out}/cfg.json",
            mode: "patch",
            // No explicit format — should be inferred as json
            inline_template: '{"b":2}',
          },
        }),
      ],
    });

    const body = JSON.parse(await readFile(join(outDir, "cfg.json"), "utf8"));
    expect(body).toEqual({ a: 1, b: 2 });
  });

  it("infers yaml format when target ends with .yaml", async () => {
    const configDir = await newTmpDir();
    const dsl = minimalDsl();
    const config = baseConfig(configDir);

    const outDir = join(configDir, "out");
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, "cfg.yaml"), "a: 1\n");

    await generateGuardrails({
      dsl,
      config,
      loadedBindings: [
        lb(configDir, {
          cfg: {
            target: "{out}/cfg.yaml",
            mode: "patch",
            // No explicit format — should be inferred as yaml
            inline_template: "b: 2\n",
          },
        }),
      ],
    });

    const raw = await readFile(join(outDir, "cfg.yaml"), "utf8");
    const body = (await import("yaml")).default.parse(raw);
    expect(body.a).toBe(1);
    expect(body.b).toBe(2);
  });

  it("infers bash format when target ends with .sh", async () => {
    const configDir = await newTmpDir();
    const dsl = minimalDsl();
    const config = baseConfig(configDir);

    const outDir = join(configDir, "out");
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, "run.sh"), "#!/bin/sh\n");

    await generateGuardrails({
      dsl,
      config,
      loadedBindings: [
        lb(configDir, {
          hook: {
            target: "{out}/run.sh",
            mode: "patch",
            patch_strategy: "section_append",
            // No explicit format — should be inferred as bash
            inline_template: "# BEGIN myblock\necho hi\n# END myblock\n",
          },
        }),
      ],
    });

    const content = await readFile(join(outDir, "run.sh"), "utf8");
    expect(content).toContain("#!/bin/sh");
    expect(content).toContain("# BEGIN myblock");
    expect(content).toContain("echo hi");
  });
});
