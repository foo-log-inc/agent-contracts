import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Dsl } from "../src/schema/index.js";
import type { ResolvedRenderTarget } from "../src/config/types.js";
import { renderFromConfig, checkDriftFromConfig } from "../src/renderer/renderer.js";

const TEMP_DIR = join(tmpdir(), "agc-tmp-renderer");

function createMinimalDsl(): Dsl {
  return {
    version: 1,
    system: {
      id: "test-system",
      name: "Test System",
      default_workflow_order: ["plan"],
    },
    agents: {
      dev: {
        role_name: "Developer",
        purpose: "Write code",
        can_read_artifacts: [],
        can_write_artifacts: [],
        can_execute_tools: [],
        can_perform_validations: [],
        can_invoke_agents: [],
        can_return_handoffs: [],
      },
      reviewer: {
        role_name: "Reviewer",
        purpose: "Review code",
        can_read_artifacts: [],
        can_write_artifacts: [],
        can_execute_tools: [],
        can_perform_validations: [],
        can_invoke_agents: [],
        can_return_handoffs: [],
      },
    },
    tasks: {},
    artifacts: {},
    tools: {},
    validations: {},
    handoff_types: {},
    workflow: {},
    policies: {},
    guardrails: {},
    guardrail_policies: {},
  };
}

beforeEach(async () => {
  await mkdir(join(TEMP_DIR, "tpl"), { recursive: true });
  await mkdir(join(TEMP_DIR, "out"), { recursive: true });
});

afterEach(async () => {
  await rm(TEMP_DIR, { recursive: true, force: true });
});

describe("renderFromConfig", () => {
  it("renders system context to single file", async () => {
    const tplPath = join(TEMP_DIR, "tpl", "overview.hbs");
    await writeFile(tplPath, "# {{system.name}}");
    const outPath = join(TEMP_DIR, "out", "overview.md");

    const targets: ResolvedRenderTarget[] = [
      { template: tplPath, context: "system", output: outPath },
    ];
    const dsl = createMinimalDsl();
    const files = await renderFromConfig(dsl, targets);

    expect(files).toEqual([outPath]);
    const content = await readFile(outPath, "utf8");
    expect(content).toBe("# Test System");
  });

  it("renders agent context per agent", async () => {
    const tplPath = join(TEMP_DIR, "tpl", "agent.hbs");
    await writeFile(tplPath, "# {{agent.role_name}}\n{{agent.id}}");
    const outPattern = join(TEMP_DIR, "out", "{agent.id}.md");

    const targets: ResolvedRenderTarget[] = [
      { template: tplPath, context: "agent", output: outPattern },
    ];
    const dsl = createMinimalDsl();
    const files = await renderFromConfig(dsl, targets);

    expect(files).toHaveLength(2);

    const devContent = await readFile(
      join(TEMP_DIR, "out", "dev.md"),
      "utf8",
    );
    expect(devContent).toContain("# Developer");
    expect(devContent).toContain("dev");

    const reviewerContent = await readFile(
      join(TEMP_DIR, "out", "reviewer.md"),
      "utf8",
    );
    expect(reviewerContent).toContain("# Reviewer");
  });

  it("respects include filter", async () => {
    const tplPath = join(TEMP_DIR, "tpl", "agent.hbs");
    await writeFile(tplPath, "{{agent.id}}");
    const outPattern = join(TEMP_DIR, "out", "{agent.id}.md");

    const targets: ResolvedRenderTarget[] = [
      {
        template: tplPath,
        context: "agent",
        output: outPattern,
        include: ["dev"],
      },
    ];
    const dsl = createMinimalDsl();
    const files = await renderFromConfig(dsl, targets);

    expect(files).toHaveLength(1);
    expect(files[0]).toContain("dev.md");
  });

  it("respects exclude filter", async () => {
    const tplPath = join(TEMP_DIR, "tpl", "agent.hbs");
    await writeFile(tplPath, "{{agent.id}}");
    const outPattern = join(TEMP_DIR, "out", "{agent.id}.md");

    const targets: ResolvedRenderTarget[] = [
      {
        template: tplPath,
        context: "agent",
        output: outPattern,
        exclude: ["dev"],
      },
    ];
    const dsl = createMinimalDsl();
    const files = await renderFromConfig(dsl, targets);

    expect(files).toHaveLength(1);
    expect(files[0]).toContain("reviewer.md");
  });

  it("can access dsl from agent context", async () => {
    const tplPath = join(TEMP_DIR, "tpl", "agent-with-dsl.hbs");
    await writeFile(tplPath, "{{agent.id}} in {{dsl.system.name}}");
    const outPattern = join(TEMP_DIR, "out", "{agent.id}.md");

    const targets: ResolvedRenderTarget[] = [
      {
        template: tplPath,
        context: "agent",
        output: outPattern,
        include: ["dev"],
      },
    ];
    const dsl = createMinimalDsl();
    await renderFromConfig(dsl, targets);

    const content = await readFile(join(TEMP_DIR, "out", "dev.md"), "utf8");
    expect(content).toBe("dev in Test System");
  });

  it("can access dsl from system context", async () => {
    const tplPath = join(TEMP_DIR, "tpl", "sys.hbs");
    await writeFile(tplPath, "{{system.name}} has {{#each dsl.agents}}{{@key}} {{/each}}");
    const outPath = join(TEMP_DIR, "out", "sys.md");

    const targets: ResolvedRenderTarget[] = [
      { template: tplPath, context: "system", output: outPath },
    ];
    const dsl = createMinimalDsl();
    await renderFromConfig(dsl, targets);

    const content = await readFile(outPath, "utf8");
    expect(content).toContain("Test System");
    expect(content).toContain("dev");
    expect(content).toContain("reviewer");
  });
});

describe("Handlebars helpers", () => {
  it("join helper concatenates array with separator", async () => {
    const tplPath = join(TEMP_DIR, "tpl", "join.hbs");
    await writeFile(tplPath, "{{join agent.can_read_artifacts \", \"}}");
    const outPattern = join(TEMP_DIR, "out", "{agent.id}.md");

    const dsl: Dsl = {
      ...createMinimalDsl(),
      agents: {
        dev: {
          ...createMinimalDsl().agents["dev"],
          can_read_artifacts: ["spec", "code", "plan"],
        },
      },
    };
    const targets: ResolvedRenderTarget[] = [
      { template: tplPath, context: "agent", output: outPattern },
    ];
    await renderFromConfig(dsl, targets);
    const content = await readFile(join(TEMP_DIR, "out", "dev.md"), "utf8");
    expect(content).toBe("spec, code, plan");
  });

  it("contains helper returns true when array includes value", async () => {
    const tplPath = join(TEMP_DIR, "tpl", "contains.hbs");
    await writeFile(
      tplPath,
      "{{#if (contains agent.can_read_artifacts \"spec\")}}YES{{else}}NO{{/if}}",
    );
    const outPattern = join(TEMP_DIR, "out", "{agent.id}.md");

    const dsl: Dsl = {
      ...createMinimalDsl(),
      agents: {
        dev: {
          ...createMinimalDsl().agents["dev"],
          can_read_artifacts: ["spec", "code"],
        },
      },
    };
    const targets: ResolvedRenderTarget[] = [
      { template: tplPath, context: "agent", output: outPattern },
    ];
    await renderFromConfig(dsl, targets);
    const content = await readFile(join(TEMP_DIR, "out", "dev.md"), "utf8");
    expect(content).toBe("YES");
  });

  it("keys helper returns object keys", async () => {
    const tplPath = join(TEMP_DIR, "tpl", "keys.hbs");
    await writeFile(tplPath, "{{#each (keys dsl.agents)}}{{this}} {{/each}}");
    const outPath = join(TEMP_DIR, "out", "overview.md");

    const targets: ResolvedRenderTarget[] = [
      { template: tplPath, context: "system", output: outPath },
    ];
    await renderFromConfig(createMinimalDsl(), targets);
    const content = await readFile(outPath, "utf8");
    expect(content).toContain("dev");
    expect(content).toContain("reviewer");
  });

  it("size helper returns count for objects and arrays", async () => {
    const tplPath = join(TEMP_DIR, "tpl", "size.hbs");
    await writeFile(tplPath, "agents={{size dsl.agents}} phases={{size system.default_workflow_order}}");
    const outPath = join(TEMP_DIR, "out", "overview.md");

    const targets: ResolvedRenderTarget[] = [
      { template: tplPath, context: "system", output: outPath },
    ];
    await renderFromConfig(createMinimalDsl(), targets);
    const content = await readFile(outPath, "utf8");
    expect(content).toBe("agents=2 phases=1");
  });

  it("filterByField helper filters arrays by field value", async () => {
    const tplPath = join(TEMP_DIR, "tpl", "filter.hbs");
    await writeFile(
      tplPath,
      "{{#each (filterByField items \"status\" \"active\")}}{{this.name}} {{/each}}",
    );
    const outPath = join(TEMP_DIR, "out", "overview.md");

    const dsl: Dsl = {
      ...createMinimalDsl(),
      system: {
        ...createMinimalDsl().system,
        "x-items": [
          { name: "a", status: "active" },
          { name: "b", status: "inactive" },
          { name: "c", status: "active" },
        ],
      } as Dsl["system"],
    };
    const targets: ResolvedRenderTarget[] = [
      { template: tplPath, context: "system", output: outPath },
    ];
    const tplContent = "{{#each (filterByField system.x-items \"status\" \"active\")}}{{this.name}} {{/each}}";
    await writeFile(tplPath, tplContent);
    await renderFromConfig(dsl, targets);
    const content = await readFile(outPath, "utf8");
    expect(content).toBe("a c ");
  });

  it("or/and/not helpers work as boolean combinators", async () => {
    const tplPath = join(TEMP_DIR, "tpl", "logic.hbs");
    await writeFile(
      tplPath,
      "{{#if (or false true)}}OR{{/if}} {{#if (and true true)}}AND{{/if}} {{#if (not false)}}NOT{{/if}}",
    );
    const outPath = join(TEMP_DIR, "out", "overview.md");

    const targets: ResolvedRenderTarget[] = [
      { template: tplPath, context: "system", output: outPath },
    ];
    await renderFromConfig(createMinimalDsl(), targets);
    const content = await readFile(outPath, "utf8");
    expect(content).toBe("OR AND NOT");
  });

  it("gt/lt/gte helpers work for numeric comparisons", async () => {
    const tplPath = join(TEMP_DIR, "tpl", "cmp.hbs");
    await writeFile(
      tplPath,
      "{{#if (gt (size dsl.agents) 1)}}MANY{{/if}}",
    );
    const outPath = join(TEMP_DIR, "out", "overview.md");

    const targets: ResolvedRenderTarget[] = [
      { template: tplPath, context: "system", output: outPath },
    ];
    await renderFromConfig(createMinimalDsl(), targets);
    const content = await readFile(outPath, "utf8");
    expect(content).toBe("MANY");
  });

  it("jsonBlock helper renders pretty JSON", async () => {
    const tplPath = join(TEMP_DIR, "tpl", "json.hbs");
    await writeFile(tplPath, "{{{jsonBlock agent}}}");
    const outPattern = join(TEMP_DIR, "out", "{agent.id}.md");

    const targets: ResolvedRenderTarget[] = [
      { template: tplPath, context: "agent", output: outPattern },
    ];
    await renderFromConfig(createMinimalDsl(), targets);
    const content = await readFile(join(TEMP_DIR, "out", "dev.md"), "utf8");
    expect(content).toContain('"role_name": "Developer"');
  });

  it("yamlFrontmatter helper wraps YAML with delimiters", async () => {
    const tplPath = join(TEMP_DIR, "tpl", "fm.hbs");
    await writeFile(
      tplPath,
      "{{{yamlFrontmatter (handoffEnvelope handoff_type)}}}",
    );
    const outPattern = join(TEMP_DIR, "out", "{handoff_type.id}.md");

    const dsl: Dsl = {
      ...createMinimalDsl(),
      handoff_types: {
        "task-request": {
          version: 1,
          example: { task_id: "specify-feature" },
          schema: { type: "object", properties: {} },
        },
      },
    };
    const targets: ResolvedRenderTarget[] = [
      { template: tplPath, context: "handoff_type", output: outPattern },
    ];
    await renderFromConfig(dsl, targets);
    const content = await readFile(
      join(TEMP_DIR, "out", "task-request.md"),
      "utf8",
    );
    expect(content).toMatch(/^---\n/);
    expect(content).toContain('type: "task-request"');
    expect(content).toMatch(/---\n$/);
  });

  it("handoffPayload and handoffEnvelope helpers render payload examples", async () => {
    const tplPath = join(TEMP_DIR, "tpl", "handoff.hbs");
    await writeFile(
      tplPath,
      [
        "PAYLOAD:",
        "{{{yamlBlock (handoffPayload handoff_type)}}}",
        "ENVELOPE:",
        "{{{jsonBlock (handoffEnvelope handoff_type)}}}",
      ].join("\n"),
    );
    const outPattern = join(TEMP_DIR, "out", "{handoff_type.id}.md");

    const dsl: Dsl = {
      ...createMinimalDsl(),
      handoff_types: {
        "task-request": {
          version: 1,
          schema: {
            type: "object",
            required: ["task_id"],
            properties: { task_id: { type: "string" } },
          },
          example: { task_id: "specify-feature" },
        },
      },
    };
    const targets: ResolvedRenderTarget[] = [
      { template: tplPath, context: "handoff_type", output: outPattern },
    ];
    await renderFromConfig(dsl, targets);
    const content = await readFile(
      join(TEMP_DIR, "out", "task-request.md"),
      "utf8",
    );
    expect(content).toContain('task_id: "specify-feature"');
    expect(content).toContain('"type": "task-request"');
    expect(content).toContain('"payload"');
  });

  it("groupBy helper groups array elements by key", async () => {
    const tplPath = join(TEMP_DIR, "tpl", "group.hbs");
    const tplContent = [
      "{{#with (groupBy items \"category\") as |groups|}}",
      "{{#each groups}}{{@key}}:{{this.length}} {{/each}}",
      "{{/with}}",
    ].join("");
    await writeFile(tplPath, tplContent);
    const outPath = join(TEMP_DIR, "out", "overview.md");

    const dsl: Dsl = {
      ...createMinimalDsl(),
      system: {
        ...createMinimalDsl().system,
        "x-items": [
          { name: "a", category: "alpha" },
          { name: "b", category: "beta" },
          { name: "c", category: "alpha" },
        ],
      } as Dsl["system"],
    };
    const tplContentFinal = [
      "{{#with (groupBy system.x-items \"category\") as |groups|}}",
      "{{#each groups}}{{@key}}:{{this.length}} {{/each}}",
      "{{/with}}",
    ].join("");
    await writeFile(tplPath, tplContentFinal);
    const targets: ResolvedRenderTarget[] = [
      { template: tplPath, context: "system", output: outPath },
    ];
    await renderFromConfig(dsl, targets);
    const content = await readFile(outPath, "utf8");
    expect(content).toContain("alpha:2");
    expect(content).toContain("beta:1");
  });
});

describe("checkDriftFromConfig", () => {
  it("reports no drift when files match", async () => {
    const tplPath = join(TEMP_DIR, "tpl", "agent.hbs");
    await writeFile(tplPath, "{{agent.id}}");
    const outPattern = join(TEMP_DIR, "out", "{agent.id}.md");

    const targets: ResolvedRenderTarget[] = [
      { template: tplPath, context: "agent", output: outPattern },
    ];
    const dsl = createMinimalDsl();

    await renderFromConfig(dsl, targets);
    const { hasDrift, diffs } = await checkDriftFromConfig(dsl, targets);

    expect(hasDrift).toBe(false);
    expect(diffs).toHaveLength(0);
  });

  it("detects drift when file content differs", async () => {
    const tplPath = join(TEMP_DIR, "tpl", "agent.hbs");
    await writeFile(tplPath, "{{agent.id}}");
    const outPattern = join(TEMP_DIR, "out", "{agent.id}.md");

    const targets: ResolvedRenderTarget[] = [
      { template: tplPath, context: "agent", output: outPattern },
    ];
    const dsl = createMinimalDsl();

    await renderFromConfig(dsl, targets);
    await writeFile(join(TEMP_DIR, "out", "dev.md"), "modified content");

    const { hasDrift, diffs } = await checkDriftFromConfig(dsl, targets);
    expect(hasDrift).toBe(true);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toContain("dev.md");
  });

  it("detects drift when file is missing", async () => {
    const tplPath = join(TEMP_DIR, "tpl", "overview.hbs");
    await writeFile(tplPath, "# {{system.name}}");
    const outPath = join(TEMP_DIR, "out", "overview.md");

    const targets: ResolvedRenderTarget[] = [
      { template: tplPath, context: "system", output: outPath },
    ];
    const dsl = createMinimalDsl();

    const { hasDrift, diffs } = await checkDriftFromConfig(dsl, targets);
    expect(hasDrift).toBe(true);
    expect(diffs).toEqual([outPath]);
  });
});
