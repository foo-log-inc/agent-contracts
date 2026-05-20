import { readFileSync, existsSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { parse as parseYaml } from "yaml";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { DslSchema, type Dsl } from "../../src/schema/index.js";
import { buildGlobalContext, buildPerAgentContext, buildWorkflowContext } from "../../src/renderer/context.js";
import { renderFromConfig, checkDriftFromConfig, expandOutputPath, hasUnresolvedPathVars, buildEntityContext } from "../../src/renderer/renderer.js";
import { generateSequenceDiagram } from "../../src/renderer/sequence-diagram.js";
import { generateOverviewFlowchart } from "../../src/renderer/overview-flowchart.js";
import { artifactOwnershipRule } from "../../src/linter/rules/artifact-ownership.js";
import { toolCommandsRule } from "../../src/linter/rules/tool-commands.js";
import type { ResolvedRenderTarget } from "../../src/config/types.js";

const fixturesDir = resolve(import.meta.dirname, "../fixtures");
const templateDir = join(fixturesDir, "templates");
const outputDir = join(import.meta.dirname, "../__output__");

let fullDsl: Dsl;

beforeAll(() => {
  const data = parseYaml(
    readFileSync(join(fixturesDir, "full/agent-contracts.yaml"), "utf8"),
  );
  fullDsl = DslSchema.parse(data);
});

afterAll(() => {
  if (existsSync(outputDir)) {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

describe("buildGlobalContext", () => {
  it("includes all entities and x- properties", () => {
    const ctx = buildGlobalContext(fullDsl);
    expect(ctx.system.id).toBe("full-system");
    expect(Object.keys(ctx.agents).length).toBeGreaterThan(0);
    expect(Object.keys(ctx.tasks).length).toBeGreaterThan(0);
    expect(Object.keys(ctx.artifacts).length).toBeGreaterThan(0);
    expect((ctx.system as Record<string, unknown>)["x-system-meta"]).toBeDefined();
  });
});

describe("buildPerAgentContext", () => {
  it("builds context for agent with related tasks, artifacts, tools", () => {
    const agent = { ...fullDsl.agents["main-architect"], id: "main-architect" };
    const ctx = buildPerAgentContext(fullDsl, agent);

    expect(ctx.agent.id).toBe("main-architect");
    expect(Object.keys(ctx.relatedArtifacts).length).toBeGreaterThan(0);
    expect(Object.keys(ctx.relatedTools).length).toBeGreaterThan(0);
  });

  it("includes dsl reference in context", () => {
    const agent = { ...fullDsl.agents["main-architect"], id: "main-architect" };
    const ctx = buildPerAgentContext(fullDsl, agent);
    expect(ctx.dsl).toBe(fullDsl);
  });

  it("merges behavioral specs: Agent + Task responsibilities combined", () => {
    const agent = { ...fullDsl.agents["implementer"], id: "implementer" };
    const ctx = buildPerAgentContext(fullDsl, agent);

    expect(ctx.mergedBehavior.responsibilities.length).toBeGreaterThan(0);
    expect(ctx.mergedBehavior.execution_steps.length).toBeGreaterThan(0);
    expect(ctx.mergedBehavior.completion_criteria.length).toBeGreaterThan(0);
  });

  it("preserves example field on relatedHandoffTypes entries", () => {
    const dsl = DslSchema.parse({
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: ["impl"] },
      agents: {
        a1: {
          role_name: "R",
          purpose: "P",
          can_return_handoffs: ["ht-with-ex", "ht-without-ex"],
        },
      },
      handoff_types: {
        "ht-with-ex": {
          version: 1,
          schema: { type: "object", properties: { x: { type: "string" } } },
          example: { x: "hello" },
        },
        "ht-without-ex": {
          version: 1,
          schema: { type: "object", properties: { y: { type: "number" } } },
        },
      },
    });
    const agent = { ...dsl.agents["a1"], id: "a1" };
    const ctx = buildPerAgentContext(dsl, agent);
    expect(ctx.relatedHandoffTypes["ht-with-ex"].example).toEqual({ x: "hello" });
    expect(ctx.relatedHandoffTypes["ht-without-ex"].example).toBeUndefined();
  });

  it("extractSchemaFieldNames handles allOf schemas", () => {
    const dsl = DslSchema.parse({
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: ["impl"] },
      agents: {
        a1: {
          role_name: "R",
          purpose: "P",
          can_invoke_agents: ["a2"],
          can_return_handoffs: ["h"],
        },
        a2: {
          role_name: "R2",
          purpose: "P2",
          can_return_handoffs: ["h"],
        },
      },
      tasks: {
        t1: {
          description: "D",
          target_agent: "a2",
          allowed_from_agents: ["a1"],
          workflow: "impl",
          input_artifacts: [],
          invocation_handoff: "h",
          result_handoff: "h",
        },
      },
      handoff_types: {
        h: {
          version: 1,
          schema: {
            allOf: [
              {
                type: "object",
                properties: {
                  from_agent: { type: "string" },
                  to_agent: { type: "string" },
                },
              },
              {
                type: "object",
                properties: {
                  payload: {
                    type: "object",
                    properties: { objective: { type: "string" } },
                  },
                },
              },
            ],
          },
        },
      },
    });
    const agent = { ...dsl.agents["a1"], id: "a1" };
    const ctx = buildPerAgentContext(dsl, agent);
    expect(ctx.delegatableTasks[0].invocation_payload_keys).toEqual(
      expect.arrayContaining(["from_agent", "to_agent", "payload"]),
    );
  });

  it("rules merge: task rule with same id overrides agent rule", () => {
    const dsl = DslSchema.parse({
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: ["impl"] },
      agents: {
        a1: {
          role_name: "R",
          purpose: "P",
          rules: [
            { id: "R1", description: "Agent version", severity: "mandatory" },
          ],
        },
      },
      tasks: {
        t1: {
          description: "d",
          target_agent: "a1",
          allowed_from_agents: ["a1"],
          workflow: "impl",
          input_artifacts: [],
          invocation_handoff: "h",
          result_handoff: "r",
          rules: [
            { id: "R1", description: "Task version", severity: "recommended" },
          ],
        },
      },
    });
    const agent = { ...dsl.agents["a1"], id: "a1" };
    const ctx = buildPerAgentContext(dsl, agent);
    const r1 = ctx.mergedBehavior.rules.find((r) => r["id"] === "R1");
    expect(r1!["description"]).toBe("Task version");
    expect(r1!["severity"]).toBe("recommended");
  });
});

function agentTarget(tpl: string, out: string, opts?: Partial<ResolvedRenderTarget>): ResolvedRenderTarget {
  return { template: tpl, context: "agent", output: out, ...opts };
}

function systemTarget(tpl: string, out: string): ResolvedRenderTarget {
  return { template: tpl, context: "system", output: out };
}

function navigationIndexTarget(tpl: string, out: string): ResolvedRenderTarget {
  return { template: tpl, context: "navigation-index", output: out };
}

describe("renderFromConfig", () => {
  it("generates per-agent md files", async () => {
    const targets: ResolvedRenderTarget[] = [
      agentTarget(
        join(templateDir, "agent-prompt.md.hbs"),
        join(outputDir, "{agent.id}.md"),
      ),
    ];
    const files = await renderFromConfig(fullDsl, targets);
    expect(files.length).toBeGreaterThan(0);

    const implFile = files.find((f) => f.includes("implementer"));
    expect(implFile).toBeDefined();
    const content = readFileSync(implFile!, "utf8");
    expect(content).toContain("Implementer");
    expect(content).toContain("Purpose");
  });

  it("generates system overview file", async () => {
    const targets: ResolvedRenderTarget[] = [
      systemTarget(
        join(templateDir, "overview.md.hbs"),
        join(outputDir, "overview.md"),
      ),
    ];
    const files = await renderFromConfig(fullDsl, targets);
    const overviewFile = files.find((f) => f.includes("overview"));
    expect(overviewFile).toBeDefined();
    const content = readFileSync(overviewFile!, "utf8");
    expect(content).toContain("Full Fixture");
    expect(content).toContain("main-architect");
  });

  it("generates navigation-index output file", async () => {
    const outputPath = join(outputDir, "navigation-index.txt");
    const targets: ResolvedRenderTarget[] = [
      navigationIndexTarget(
        join(templateDir, "navigation-index.hbs"),
        outputPath,
      ),
    ];
    const files = await renderFromConfig(fullDsl, targets);
    expect(files).toEqual([outputPath]);
    const content = readFileSync(outputPath, "utf8");
    expect(content).toContain("System: full-system");
    expect(content).toContain("Artifact: spec-md");
    expect(content).toContain("Artifact: codebase");
  });

  it("renders x- properties when present", async () => {
    const targets: ResolvedRenderTarget[] = [
      agentTarget(
        join(templateDir, "agent-prompt.md.hbs"),
        join(outputDir, "{agent.id}.md"),
      ),
    ];
    const files = await renderFromConfig(fullDsl, targets);
    const archFile = files.find((f) => f.includes("main-architect"));
    expect(archFile).toBeDefined();
    const content = readFileSync(archFile!, "utf8");
    expect(content).toContain("Identity");
    expect(content).toContain("Architect identity text");
  });

  it("omits x- sections when absent", async () => {
    const targets: ResolvedRenderTarget[] = [
      agentTarget(
        join(templateDir, "agent-prompt.md.hbs"),
        join(outputDir, "{agent.id}.md"),
      ),
    ];
    const files = await renderFromConfig(fullDsl, targets);
    const twFile = files.find((f) => f.includes("test-writer"));
    expect(twFile).toBeDefined();
    const content = readFileSync(twFile!, "utf8");
    expect(content).not.toContain("Identity");
    expect(content).not.toContain("Role Selection Guide");
  });

  it("renders relatedArtifacts / relatedTools / relatedHandoffTypes sections via notEmpty helper", async () => {
    const targets: ResolvedRenderTarget[] = [
      agentTarget(
        join(templateDir, "agent-prompt.md.hbs"),
        join(outputDir, "{agent.id}.md"),
      ),
    ];
    const files = await renderFromConfig(fullDsl, targets);
    const archFile = files.find((f) => f.includes("main-architect"));
    expect(archFile).toBeDefined();
    const content = readFileSync(archFile!, "utf8");

    expect(content).toContain("## Related Artifacts");
    expect(content).toContain("**spec-md**");
    expect(content).toContain("## Available Tools");
    expect(content).toContain("**gh-pr-inspect**");
    expect(content).toContain("## Handoff Types");
    expect(content).toContain("### evidence-gate-verdict (v1)");
  });

  it("omits relatedArtifacts section when agent has no related artifacts", async () => {
    const dsl = DslSchema.parse({
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: ["impl"] },
      agents: { a1: { role_name: "R", purpose: "P" } },
    });
    const targets: ResolvedRenderTarget[] = [
      agentTarget(
        join(templateDir, "agent-prompt.md.hbs"),
        join(outputDir, "{agent.id}.md"),
      ),
    ];
    const files = await renderFromConfig(dsl, targets);
    const content = readFileSync(files[0], "utf8");
    expect(content).not.toContain("## Related Artifacts");
    expect(content).not.toContain("## Available Tools");
    expect(content).not.toContain("## Handoff Types");
  });
});

describe("checkDriftFromConfig", () => {
  it("returns no drift when files are up to date", async () => {
    const targets: ResolvedRenderTarget[] = [
      agentTarget(
        join(templateDir, "agent-prompt.md.hbs"),
        join(outputDir, "{agent.id}.md"),
      ),
      systemTarget(
        join(templateDir, "overview.md.hbs"),
        join(outputDir, "overview.md"),
      ),
    ];
    await renderFromConfig(fullDsl, targets);
    const result = await checkDriftFromConfig(fullDsl, targets);
    expect(result.hasDrift).toBe(false);
    expect(result.diffs).toHaveLength(0);
  });

  it("returns no drift for navigation-index when file is up to date", async () => {
    const outputPath = join(outputDir, "nav-index-drift.txt");
    const targets: ResolvedRenderTarget[] = [
      navigationIndexTarget(
        join(templateDir, "navigation-index.hbs"),
        outputPath,
      ),
    ];
    await renderFromConfig(fullDsl, targets);
    const result = await checkDriftFromConfig(fullDsl, targets);
    expect(result.hasDrift).toBe(false);
    expect(result.diffs).toHaveLength(0);
  });

  it("returns drift for navigation-index when file is missing", async () => {
    const emptyDir = join(import.meta.dirname, "../__empty_nav_output__");
    const targets: ResolvedRenderTarget[] = [
      navigationIndexTarget(
        join(templateDir, "navigation-index.hbs"),
        join(emptyDir, "navigation-index.txt"),
      ),
    ];
    const result = await checkDriftFromConfig(fullDsl, targets);
    expect(result.hasDrift).toBe(true);
    expect(result.diffs).toContain(join(emptyDir, "navigation-index.txt"));
  });

  it("returns drift when files are missing", async () => {
    const emptyDir = join(import.meta.dirname, "../__empty_output__");
    const targets: ResolvedRenderTarget[] = [
      agentTarget(
        join(templateDir, "agent-prompt.md.hbs"),
        join(emptyDir, "{agent.id}.md"),
      ),
      systemTarget(
        join(templateDir, "overview.md.hbs"),
        join(emptyDir, "overview.md"),
      ),
    ];
    const result = await checkDriftFromConfig(fullDsl, targets);
    expect(result.hasDrift).toBe(true);
    expect(result.diffs.length).toBeGreaterThan(0);
  });
});

function toolTarget(tpl: string, out: string, opts?: Partial<ResolvedRenderTarget>): ResolvedRenderTarget {
  return { template: tpl, context: "tool", output: out, ...opts };
}

describe("skip_empty", () => {
  const skipEmptyDir = join(import.meta.dirname, "../__skip_empty_output__");

  afterAll(() => {
    if (existsSync(skipEmptyDir)) {
      rmSync(skipEmptyDir, { recursive: true, force: true });
    }
  });

  const dslWithXScript = DslSchema.parse({
    version: 1,
    system: { id: "s", name: "S", default_workflow_order: ["w"] },
    agents: {
      dev: { role_name: "Dev", purpose: "P", can_execute_tools: ["with-script", "without-script"] },
    },
    tools: {
      "with-script": {
        kind: "cli",
        invokable_by: ["dev"],
        "x-script": "#!/usr/bin/env bash\necho hello",
      },
      "without-script": {
        kind: "cli",
        invokable_by: ["dev"],
      },
    },
  });

  it("does not generate file when template output is empty and skip_empty is true", async () => {
    const targets: ResolvedRenderTarget[] = [
      toolTarget(
        join(templateDir, "tool-script.sh.hbs"),
        join(skipEmptyDir, "{tool.id}.sh"),
        { skip_empty: true },
      ),
    ];
    const files = await renderFromConfig(dslWithXScript, targets);
    expect(files).toContain(join(skipEmptyDir, "with-script.sh"));
    expect(files).not.toContain(join(skipEmptyDir, "without-script.sh"));
    expect(existsSync(join(skipEmptyDir, "with-script.sh"))).toBe(true);
    expect(existsSync(join(skipEmptyDir, "without-script.sh"))).toBe(false);
    const content = readFileSync(join(skipEmptyDir, "with-script.sh"), "utf8");
    expect(content).toContain("echo hello");
  });

  it("deletes pre-existing file when template output becomes empty with skip_empty", async () => {
    const staleFile = join(skipEmptyDir, "without-script.sh");
    mkdirSync(skipEmptyDir, { recursive: true });
    writeFileSync(staleFile, "stale content", "utf8");
    expect(existsSync(staleFile)).toBe(true);

    const targets: ResolvedRenderTarget[] = [
      toolTarget(
        join(templateDir, "tool-script.sh.hbs"),
        join(skipEmptyDir, "{tool.id}.sh"),
        { skip_empty: true },
      ),
    ];
    await renderFromConfig(dslWithXScript, targets);
    expect(existsSync(staleFile)).toBe(false);
  });

  it("still generates empty file when skip_empty is not set", async () => {
    const noSkipDir = join(skipEmptyDir, "no-skip");
    const targets: ResolvedRenderTarget[] = [
      toolTarget(
        join(templateDir, "tool-script.sh.hbs"),
        join(noSkipDir, "{tool.id}.sh"),
      ),
    ];
    const files = await renderFromConfig(dslWithXScript, targets);
    expect(files).toContain(join(noSkipDir, "without-script.sh"));
    expect(existsSync(join(noSkipDir, "without-script.sh"))).toBe(true);
  });

  it("checkDrift reports no drift when file is absent and output is empty with skip_empty", async () => {
    const driftDir = join(skipEmptyDir, "drift-check");
    const targets: ResolvedRenderTarget[] = [
      toolTarget(
        join(templateDir, "tool-script.sh.hbs"),
        join(driftDir, "{tool.id}.sh"),
        { skip_empty: true },
      ),
    ];
    await renderFromConfig(dslWithXScript, targets);
    const result = await checkDriftFromConfig(dslWithXScript, targets);
    expect(result.hasDrift).toBe(false);
  });

  it("checkDrift reports drift when file exists but output is empty with skip_empty", async () => {
    const driftDir = join(skipEmptyDir, "drift-stale");
    const staleFile = join(driftDir, "without-script.sh");
    mkdirSync(driftDir, { recursive: true });
    writeFileSync(staleFile, "stale", "utf8");

    const targets: ResolvedRenderTarget[] = [
      toolTarget(
        join(templateDir, "tool-script.sh.hbs"),
        join(driftDir, "{tool.id}.sh"),
        { skip_empty: true },
      ),
    ];
    const result = await checkDriftFromConfig(dslWithXScript, targets);
    expect(result.diffs).toContain(staleFile);
  });
});

describe("generateSequenceDiagram", () => {
  it("generates valid mermaid structure from fixture DSL", () => {
    const ctx = buildWorkflowContext(fullDsl, "implement");
    const output = generateSequenceDiagram(ctx.workflow, ctx.relatedTasks, fullDsl);

    expect(output).toContain("sequenceDiagram");
    expect(output).toContain("participant");
    expect(output).toContain("rect ");
    expect(output).toContain("Note over ");
  });

  it("emits [R] for reads_artifact and [W] for produces_artifact", () => {
    const ctx = buildWorkflowContext(fullDsl, "implement");
    const output = generateSequenceDiagram(ctx.workflow, ctx.relatedTasks, fullDsl);

    expect(output).toContain("[R] Read spec-md");
    expect(output).toContain("[W] Change codebase");
  });

  it("emits tool invocation arrows from uses_tool", () => {
    const ctx = buildWorkflowContext(fullDsl, "implement");
    const output = generateSequenceDiagram(ctx.workflow, ctx.relatedTasks, fullDsl);

    expect(output).toContain("eslint_runner");
    expect(output).toContain("Change codebase");
  });

  it("emits delegation and result_handoff arrows", () => {
    const ctx = buildWorkflowContext(fullDsl, "implement");
    const output = generateSequenceDiagram(ctx.workflow, ctx.relatedTasks, fullDsl);

    expect(output).toContain("delegate implement-feature");
    expect(output).toContain("dependency-evidence");
  });

  it("emits validation step with executor and target_artifact", () => {
    const ctx = buildWorkflowContext(fullDsl, "implement");
    const output = generateSequenceDiagram(ctx.workflow, ctx.relatedTasks, fullDsl);

    expect(output).toContain("code-lint");
    expect(output).toContain("[R] codebase");
  });

  it("emits alt/else for decision step", () => {
    const ctx = buildWorkflowContext(fullDsl, "implement");
    const output = generateSequenceDiagram(ctx.workflow, ctx.relatedTasks, fullDsl);

    expect(output).toContain("alt PASS");
    expect(output).toContain("else BLOCK");
    expect(output).toMatch(/end/);
  });

  it("groups participants into Agents, Toolchain, Artifacts boxes", () => {
    const ctx = buildWorkflowContext(fullDsl, "implement");
    const output = generateSequenceDiagram(ctx.workflow, ctx.relatedTasks, fullDsl);

    expect(output).toContain("box rgb(200,220,255) Agents");
    expect(output).toContain("box rgb(220,255,220) Toolchain");
    expect(output).toContain("box rgb(255,230,210) Artifacts");
  });

  it("includes description in workflow Note when present", () => {
    const dsl = DslSchema.parse({
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: ["build"] },
      agents: {
        dev: { role_name: "Developer", purpose: "P", can_write_artifacts: ["code"], can_return_handoffs: ["result"] },
      },
      tasks: {
        "write-code": {
          description: "Write code",
          target_agent: "dev",
          allowed_from_agents: ["dev"],
          workflow: "build",
          input_artifacts: [],
          invocation_handoff: "start",
          result_handoff: "result",
          execution_steps: [
            { id: "w", action: "Write files", produces_artifact: "code" },
          ],
        },
      },
      artifacts: {
        code: { type: "code", owner: "dev", producers: ["dev"], editors: ["dev"], consumers: [], states: ["done"] },
      },
      workflow: {
        build: {
          steps: [
            { type: "handoff", handoff_kind: "delegation", task: "write-code", from_agent: "dev" },
          ],
          description: "Build phase summary",
        },
      },
    });
    const ctx = buildWorkflowContext(dsl, "build");
    const output = generateSequenceDiagram(ctx.workflow, ctx.relatedTasks, dsl);
    expect(output).toContain("build — Build phase summary");
  });

  it("handles handoff step without task (task-less handoff)", () => {
    const dsl = DslSchema.parse({
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: ["flow"] },
      agents: {
        mgr: { role_name: "Manager", purpose: "P" },
      },
      workflow: {
        flow: {
          steps: [
            { type: "handoff", handoff_kind: "notify", from_agent: "mgr" },
          ],
        },
      },
    });
    const ctx = buildWorkflowContext(dsl, "flow");
    const output = generateSequenceDiagram(ctx.workflow, ctx.relatedTasks, dsl);
    expect(output).toContain("sequenceDiagram");
    expect(output).toContain("notify");
  });

  it("emits external_participants as actor/participant in External box", () => {
    const dsl = DslSchema.parse({
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: ["flow"] },
      agents: {
        dev: { role_name: "Developer", purpose: "P", can_return_handoffs: ["result"] },
      },
      tasks: {
        "do-work": {
          description: "Work",
          target_agent: "dev",
          allowed_from_agents: ["dev"],
          workflow: "flow",
          input_artifacts: [],
          invocation_handoff: "start",
          result_handoff: "result",
        },
      },
      workflow: {
        flow: {
          trigger: "User requests work",
          external_participants: [
            { id: "user", kind: "actor", label: "User", description: "Requester" },
            { id: "ta", kind: "participant", label: "Tech Advisory" },
          ],
          steps: [
            { type: "handoff", handoff_kind: "delegation", task: "do-work", from_agent: "dev" },
          ],
        },
      },
    });
    const ctx = buildWorkflowContext(dsl, "flow");
    const output = generateSequenceDiagram(ctx.workflow, ctx.relatedTasks, dsl);
    expect(output).toContain("box rgb(255,245,230) External");
    expect(output).toContain("actor user as User");
    expect(output).toContain("participant ta as Tech Advisory");
    expect(output).toContain("user->>"); // trigger arrow
  });

  it("emits opt block for retry on handoff step", () => {
    const ctx = buildWorkflowContext(fullDsl, "implement");
    const output = generateSequenceDiagram(ctx.workflow, ctx.relatedTasks, fullDsl);
    expect(output).toContain("opt Lint failures found");
    expect(output).toContain("fix implement-feature");
  });

  it("emits par block for grouped steps", () => {
    const dsl = DslSchema.parse({
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: ["audit"] },
      agents: {
        arch: { role_name: "Architect", purpose: "P", can_invoke_agents: ["pol1", "pol2"] },
        pol1: { role_name: "Police A", purpose: "P", mode: "read-only", can_return_handoffs: ["result"] },
        pol2: { role_name: "Police B", purpose: "P", mode: "read-only", can_return_handoffs: ["result"] },
      },
      tasks: {
        "audit-a": {
          description: "A",
          target_agent: "pol1",
          allowed_from_agents: ["arch"],
          workflow: "audit",
          input_artifacts: [],
          invocation_handoff: "delegation",
          result_handoff: "result",
        },
        "audit-b": {
          description: "B",
          target_agent: "pol2",
          allowed_from_agents: ["arch"],
          workflow: "audit",
          input_artifacts: [],
          invocation_handoff: "delegation",
          result_handoff: "result",
        },
      },
      workflow: {
        audit: {
          steps: [
            { type: "handoff", handoff_kind: "delegation", task: "audit-a", from_agent: "arch", group: "police-audit" },
            { type: "handoff", handoff_kind: "delegation", task: "audit-b", from_agent: "arch", group: "police-audit" },
          ],
        },
      },
    });
    const ctx = buildWorkflowContext(dsl, "audit");
    const output = generateSequenceDiagram(ctx.workflow, ctx.relatedTasks, dsl);
    expect(output).toContain("par police-audit");
    expect(output).toContain("and");
    expect(output).toContain("box rgb(255,220,220) Audit");
  });

  it("emits delegate step with task and result arrows", () => {
    const dsl = DslSchema.parse({
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: ["build"] },
      agents: {
        arch: { role_name: "Architect", purpose: "P", can_invoke_agents: ["dev"] },
        dev: { role_name: "Developer", purpose: "P", can_write_artifacts: ["code"], can_return_handoffs: ["result"] },
      },
      tasks: {
        "write-code": {
          description: "Write code",
          target_agent: "dev",
          allowed_from_agents: ["arch"],
          workflow: "build",
          input_artifacts: [],
          invocation_handoff: "start",
          result_handoff: "result",
          execution_steps: [
            { id: "w", action: "Write files", produces_artifact: "code" },
          ],
        },
      },
      artifacts: {
        code: { type: "code", owner: "dev", producers: ["dev"], editors: ["dev"], consumers: [], states: ["done"] },
      },
      workflow: {
        build: {
          steps: [
            { type: "delegate", task: "write-code", from_agent: "arch" },
          ],
        },
      },
    });
    const ctx = buildWorkflowContext(dsl, "build");
    const output = generateSequenceDiagram(ctx.workflow, ctx.relatedTasks, dsl);
    expect(output).toContain("delegate write-code");
    expect(output).toContain("result");
    expect(output).toContain("[W] Write files");
  });

  it("emits gate step as self-note on last from_agent", () => {
    const dsl = DslSchema.parse({
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: ["review"] },
      agents: {
        arch: { role_name: "Architect", purpose: "P", can_invoke_agents: ["dev"] },
        dev: { role_name: "Developer", purpose: "P", can_return_handoffs: ["result"] },
      },
      tasks: {
        "do-work": {
          description: "Work",
          target_agent: "dev",
          allowed_from_agents: ["arch"],
          workflow: "review",
          input_artifacts: [],
          invocation_handoff: "start",
          result_handoff: "result",
        },
      },
      handoff_types: {
        "evidence-gate": {
          version: 1,
          schema: { type: "object", properties: { verdict: { type: "string" } } },
        },
      },
      workflow: {
        review: {
          steps: [
            { type: "delegate", task: "do-work", from_agent: "arch" },
            { type: "gate", gate_kind: "evidence-gate" },
          ],
        },
      },
    });
    const ctx = buildWorkflowContext(dsl, "review");
    const output = generateSequenceDiagram(ctx.workflow, ctx.relatedTasks, dsl);
    expect(output).toContain("delegate do-work");
    expect(output).toContain("evidence-gate");
  });

  it("emits retry block for delegate step", () => {
    const dsl = DslSchema.parse({
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: ["build"] },
      agents: {
        arch: { role_name: "Architect", purpose: "P", can_invoke_agents: ["dev"] },
        dev: { role_name: "Developer", purpose: "P", can_return_handoffs: ["result"] },
      },
      tasks: {
        "write-code": {
          description: "Write code",
          target_agent: "dev",
          allowed_from_agents: ["arch"],
          workflow: "build",
          input_artifacts: [],
          invocation_handoff: "start",
          result_handoff: "result",
        },
      },
      workflow: {
        build: {
          steps: [
            {
              type: "delegate",
              task: "write-code",
              from_agent: "arch",
              retry: { condition: "Lint failures", fix_task: "write-code" },
            },
          ],
        },
      },
    });
    const ctx = buildWorkflowContext(dsl, "build");
    const output = generateSequenceDiagram(ctx.workflow, ctx.relatedTasks, dsl);
    expect(output).toContain("opt Lint failures");
    expect(output).toContain("fix write-code");
  });

  it("emits par block for grouped delegate steps", () => {
    const dsl = DslSchema.parse({
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: ["audit"] },
      agents: {
        arch: { role_name: "Architect", purpose: "P", can_invoke_agents: ["pol1", "pol2"] },
        pol1: { role_name: "Police A", purpose: "P", mode: "read-only", can_return_handoffs: ["result"] },
        pol2: { role_name: "Police B", purpose: "P", mode: "read-only", can_return_handoffs: ["result"] },
      },
      tasks: {
        "audit-a": {
          description: "A",
          target_agent: "pol1",
          allowed_from_agents: ["arch"],
          workflow: "audit",
          input_artifacts: [],
          invocation_handoff: "delegation",
          result_handoff: "result",
        },
        "audit-b": {
          description: "B",
          target_agent: "pol2",
          allowed_from_agents: ["arch"],
          workflow: "audit",
          input_artifacts: [],
          invocation_handoff: "delegation",
          result_handoff: "result",
        },
      },
      workflow: {
        audit: {
          steps: [
            { type: "delegate", task: "audit-a", from_agent: "arch", group: "police-audit" },
            { type: "delegate", task: "audit-b", from_agent: "arch", group: "police-audit" },
          ],
        },
      },
    });
    const ctx = buildWorkflowContext(dsl, "audit");
    const output = generateSequenceDiagram(ctx.workflow, ctx.relatedTasks, dsl);
    expect(output).toContain("par police-audit");
    expect(output).toContain("and");
    expect(output).toContain("box rgb(255,220,220) Audit");
  });

  it("generates sequence diagram with delegate and gate from fixture", () => {
    const ctx = buildWorkflowContext(fullDsl, "specify");
    const output = generateSequenceDiagram(ctx.workflow, ctx.relatedTasks, fullDsl);
    expect(output).toContain("sequenceDiagram");
    expect(output).toContain("delegate run-spec-lint");
    expect(output).toContain("evidence-gate-verdict");
  });

  it("separates read-only agents into Audit box", () => {
    const dsl = DslSchema.parse({
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: ["check"] },
      agents: {
        mgr: { role_name: "Manager", purpose: "P", can_invoke_agents: ["auditor"] },
        auditor: { role_name: "Auditor", purpose: "P", mode: "read-only", can_return_handoffs: ["result"] },
      },
      tasks: {
        "run-audit": {
          description: "Audit",
          target_agent: "auditor",
          allowed_from_agents: ["mgr"],
          workflow: "check",
          input_artifacts: [],
          invocation_handoff: "delegation",
          result_handoff: "result",
        },
      },
      workflow: {
        check: {
          steps: [
            { type: "handoff", handoff_kind: "delegation", task: "run-audit", from_agent: "mgr" },
          ],
        },
      },
    });
    const ctx = buildWorkflowContext(dsl, "check");
    const output = generateSequenceDiagram(ctx.workflow, ctx.relatedTasks, dsl);
    expect(output).toContain("box rgb(200,220,255) Agents");
    expect(output).toContain("box rgb(255,220,220) Audit");
  });
});

describe("generateOverviewFlowchart", () => {
  it("generates Agent/Artifact/Tool × Phase matrix tables", () => {
    const output = generateOverviewFlowchart(fullDsl);
    expect(output).toContain("#### Agent × Phase");
    expect(output).toContain("#### Artifact × Phase");
    expect(output).toContain("#### Tool × Phase");
    expect(output).toContain("implement");
  });

  it("shows operation types (delegate, execute, R, W, V) in cells", () => {
    const output = generateOverviewFlowchart(fullDsl);
    expect(output).toContain("delegate");
    expect(output).toContain("execute");
    expect(output).toMatch(/\bR\b/);
    expect(output).toMatch(/\bW\b/);
  });
});

describe("linter: artifact-ownership", () => {
  it("warns when agent produces artifact but is not in producers/editors", () => {
    const dsl = DslSchema.parse({
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: ["w"] },
      agents: {
        dev: { role_name: "Dev", purpose: "P", can_write_artifacts: ["doc"], can_return_handoffs: ["r"] },
      },
      tasks: {
        "write-doc": {
          description: "Write doc",
          target_agent: "dev",
          allowed_from_agents: ["dev"],
          workflow: "w",
          input_artifacts: [],
          invocation_handoff: "start",
          result_handoff: "r",
          execution_steps: [
            { id: "s1", action: "Write", produces_artifact: "doc" },
          ],
        },
      },
      artifacts: {
        doc: { type: "document", owner: "other", producers: ["other"], editors: [], consumers: [], states: ["draft"] },
      },
      workflow: { w: { steps: [] } },
    });
    const diagnostics = artifactOwnershipRule.run(dsl);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0].ruleId).toBe("artifact-ownership");
    expect(diagnostics[0].message).toContain("produces artifact");
  });
});

describe("linter: tool-commands", () => {
  it("errors when command reads non-existent artifact", () => {
    const dsl = DslSchema.parse({
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: ["w"] },
      agents: {
        dev: { role_name: "Dev", purpose: "P", can_execute_tools: ["t1"] },
      },
      tools: {
        t1: {
          kind: "cli",
          invokable_by: ["dev"],
          commands: [
            { command: "run", category: "verification", reads: ["nonexistent"], writes: [] },
          ],
        },
      },
      workflow: { w: { steps: [] } },
    });
    const diagnostics = toolCommandsRule.run(dsl);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0].ruleId).toBe("tool-commands");
    expect(diagnostics[0].message).toContain("nonexistent");
  });

  it("warns when command writes artifact not in output_artifacts", () => {
    const dsl = DslSchema.parse({
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: ["w"] },
      agents: {
        dev: { role_name: "Dev", purpose: "P", can_execute_tools: ["t1"] },
      },
      artifacts: {
        report: { type: "report", owner: "dev", producers: ["dev"], editors: [], consumers: [], states: ["done"] },
      },
      tools: {
        t1: {
          kind: "cli",
          invokable_by: ["dev"],
          output_artifacts: [],
          commands: [
            { command: "gen", category: "generation", reads: [], writes: ["report"] },
          ],
        },
      },
      workflow: { w: { steps: [] } },
    });
    const diagnostics = toolCommandsRule.run(dsl);
    const writeWarning = diagnostics.find((d: { message: string }) => d.message.includes("output_artifacts"));
    expect(writeWarning).toBeDefined();
  });
});

describe("renderFromConfig with bindings", () => {
  it("passes bindings to system context template", async () => {
    const templatePath = join(outputDir, "binding-test.md.hbs");
    const outputPath = join(outputDir, "binding-test.md");
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(templatePath, "{{#if guardrailEnforcement}}HAS_ENFORCEMENT{{else}}NO_ENFORCEMENT{{/if}}", "utf8");

    const dsl = DslSchema.parse({
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: ["implement"] },
      guardrails: {
        "no-force-push": { description: "No force push", scope: { tools: ["t1"] }, tags: [] },
      },
      guardrail_policies: {
        main: { rules: [{ guardrail: "no-force-push", severity: "critical", action: "block" }] },
      },
    });

    const targets: ResolvedRenderTarget[] = [
      { template: templatePath, context: "system", output: outputPath },
    ];

    const loadedBindings = [{
      filePath: "/test.yaml",
      binding: {
        software: "cursor",
        version: 1 as const,
        guardrail_impl: {
          "no-force-push": {
            checks: [{ matcher: { type: "command_regex" as const, pattern: "force" } }],
          },
        },
      },
    }];

    const files = await renderFromConfig(dsl, targets, {
      loadedBindings,
      activeGuardrailPolicy: "main",
    });

    expect(files).toHaveLength(1);
    const content = readFileSync(outputPath, "utf8");
    expect(content).toBe("HAS_ENFORCEMENT");
  });

  it("renders without enforcement when no bindings", async () => {
    const templatePath = join(outputDir, "no-binding-test.md.hbs");
    const outputPath = join(outputDir, "no-binding-test.md");
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(templatePath, "{{#if guardrailEnforcement}}HAS{{else}}NONE{{/if}}", "utf8");

    const dsl = DslSchema.parse({
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: ["implement"] },
    });

    const targets: ResolvedRenderTarget[] = [
      { template: templatePath, context: "system", output: outputPath },
    ];

    const files = await renderFromConfig(dsl, targets);
    expect(files).toHaveLength(1);
    const content = readFileSync(outputPath, "utf8");
    expect(content).toBe("NONE");
  });
});

describe("guardrailCoverageMatrix helper", () => {
  it("generates markdown table from enforcement data", async () => {
    const templatePath = join(outputDir, "matrix-test.md.hbs");
    const outputPath = join(outputDir, "matrix-test.md");
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(templatePath, "{{{guardrailCoverageMatrix}}}", "utf8");

    const dsl = DslSchema.parse({
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: ["implement"] },
      guardrails: {
        "no-force-push": { description: "No force push", scope: { tools: ["editor"] }, tags: [] },
      },
      guardrail_policies: {
        main: { rules: [{ guardrail: "no-force-push", severity: "critical", action: "block" }] },
      },
    });

    const targets: ResolvedRenderTarget[] = [
      { template: templatePath, context: "system", output: outputPath },
    ];

    const files = await renderFromConfig(dsl, targets, {
      loadedBindings: [{
        filePath: "/b.yaml",
        binding: { software: "cursor", version: 1 as const },
      }],
      activeGuardrailPolicy: "main",
    });

    expect(files).toHaveLength(1);
    const content = readFileSync(outputPath, "utf8");
    expect(content).toContain("no-force-push");
    expect(content).toContain("critical");
    expect(content).toContain("block");
    expect(content).toContain("editor");
  });

  it("returns empty string when no enforcement data", async () => {
    const templatePath = join(outputDir, "empty-matrix.md.hbs");
    const outputPath = join(outputDir, "empty-matrix.md");
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(templatePath, "START{{{guardrailCoverageMatrix}}}END", "utf8");

    const dsl = DslSchema.parse({
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: ["implement"] },
    });

    const targets: ResolvedRenderTarget[] = [
      { template: templatePath, context: "system", output: outputPath },
    ];

    const files = await renderFromConfig(dsl, targets);
    expect(files).toHaveLength(1);
    const content = readFileSync(outputPath, "utf8");
    expect(content).toBe("STARTEND");
  });
});

describe("expandOutputPath", () => {
  it("expands {context.id} without entity", () => {
    const result = expandOutputPath("out/{agent.id}/file.md", "agent", "my-agent");
    expect(result).toBe("out/my-agent/file.md");
  });

  it("expands {context.id} with entity", () => {
    const entity = { role_name: "architect", "x-claude-path": "backend" };
    const result = expandOutputPath("out/{agent.id}/file.md", "agent", "my-agent", entity);
    expect(result).toBe("out/my-agent/file.md");
  });

  it("expands standard fields from entity", () => {
    const entity = { role_name: "architect", "x-claude-path": "backend" };
    const result = expandOutputPath("{agent.role_name}/file.md", "agent", "my-agent", entity);
    expect(result).toBe("architect/file.md");
  });

  it("expands x-* extension fields from entity", () => {
    const entity = { role_name: "architect", "x-claude-path": "packages/backend" };
    const result = expandOutputPath("../{agent.x-claude-path}/CLAUDE.md", "agent", "my-agent", entity);
    expect(result).toBe("../packages/backend/CLAUDE.md");
  });

  it("leaves pattern unresolved when field is undefined", () => {
    const entity = { role_name: "architect" };
    const result = expandOutputPath("../{agent.x-claude-path}/CLAUDE.md", "agent", "my-agent", entity);
    expect(result).toBe("../{agent.x-claude-path}/CLAUDE.md");
  });

  it("leaves pattern unresolved when entity is undefined", () => {
    const result = expandOutputPath("../{agent.x-claude-path}/CLAUDE.md", "agent", "my-agent");
    expect(result).toBe("../{agent.x-claude-path}/CLAUDE.md");
  });

  it("leaves pattern unresolved when field value is not a string", () => {
    const entity = { "x-path": 123 };
    const result = expandOutputPath("../{agent.x-path}/CLAUDE.md", "agent", "my-agent", entity);
    expect(result).toBe("../{agent.x-path}/CLAUDE.md");
  });

  it("expands multiple different fields in one pattern", () => {
    const entity = { "x-claude-path": "frontend", role_name: "dev" };
    const result = expandOutputPath("{agent.x-claude-path}/{agent.role_name}/{agent.id}.md", "agent", "ui-agent", entity);
    expect(result).toBe("frontend/dev/ui-agent.md");
  });

  it("works with guardrail context", () => {
    const entity = { severity: "critical" };
    const result = expandOutputPath("guardrails/{guardrail.id}/{guardrail.severity}.md", "guardrail", "no-force-push", entity);
    expect(result).toBe("guardrails/no-force-push/critical.md");
  });
});

describe("hasUnresolvedPathVars", () => {
  it("returns false for fully resolved path", () => {
    expect(hasUnresolvedPathVars("out/my-agent/file.md")).toBe(false);
  });

  it("returns true for path with unresolved variable", () => {
    expect(hasUnresolvedPathVars("../{agent.x-claude-path}/CLAUDE.md")).toBe(true);
  });

  it("returns true for path with multiple unresolved variables", () => {
    expect(hasUnresolvedPathVars("{agent.x-path}/{agent.name}/file.md")).toBe(true);
  });

  it("returns false for path with no braces", () => {
    expect(hasUnresolvedPathVars("simple/path/file.md")).toBe(false);
  });
});

describe("renderFromConfig - unresolved path skipping", () => {
  it("skips rendering when output path has unresolved variables", async () => {
    const templatePath = join(outputDir, "skip-unresolved.hbs");
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(templatePath, "content for {{agent.id}}", "utf8");

    const dsl = DslSchema.parse({
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: ["implement"] },
      agents: {
        "agent-with-path": { role_name: "Dev", purpose: "dev", "x-claude-path": "packages/app" },
        "agent-without-path": { role_name: "Reviewer", purpose: "review" },
      },
    });

    const targets: ResolvedRenderTarget[] = [
      {
        template: templatePath,
        context: "agent",
        output: join(outputDir, "{agent.x-claude-path}/CLAUDE.md"),
      },
    ];

    const files = await renderFromConfig(dsl, targets);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain("packages/app/CLAUDE.md");
  });

  it("renders all agents when all paths resolve", async () => {
    const templatePath = join(outputDir, "all-resolve.hbs");
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(templatePath, "hi {{agent.id}}", "utf8");

    const dsl = DslSchema.parse({
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: ["implement"] },
      agents: {
        "a1": { role_name: "Dev", purpose: "dev", "x-claude-path": "pkg/a" },
        "a2": { role_name: "QA", purpose: "qa", "x-claude-path": "pkg/b" },
      },
    });

    const targets: ResolvedRenderTarget[] = [
      {
        template: templatePath,
        context: "agent",
        output: join(outputDir, "{agent.x-claude-path}/out.md"),
      },
    ];

    const files = await renderFromConfig(dsl, targets);
    expect(files).toHaveLength(2);
  });
});
