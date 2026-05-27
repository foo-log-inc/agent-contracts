import { resolve, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { rmSync, existsSync, writeFileSync } from "node:fs";
import { describe, it, expect, afterAll, beforeAll } from "vitest";

const exec = promisify(execFile);
const fixturesDir = resolve(import.meta.dirname, "../fixtures");
const cliPath = resolve(import.meta.dirname, "../../dist/cli.js");
const outputDir = join(tmpdir(), "agc-cli-output");
const bindingsOutputDir = join(tmpdir(), "agc-cli-output-bindings");

const minimalYaml = join(fixturesDir, "minimal/agent-contracts.yaml");
const renderConfig = join(tmpdir(), "agc-cli-render.config.yaml");
const bindingsRenderConfig = join(tmpdir(), "agc-cli-bindings-render.config.yaml");

async function run(
  args: string[],
  options?: { cwd?: string },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await exec("node", [cliPath, ...args], {
      timeout: 10000,
      cwd: options?.cwd,
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      exitCode: e.code ?? 1,
    };
  }
}

beforeAll(() => {
  writeFileSync(renderConfig, [
    `dsl: ${join(fixturesDir, "minimal/agent-contracts.yaml")}`,
    "renders:",
    `  - template: ${join(fixturesDir, "templates/agent-prompt.md.hbs")}`,
    "    context: agent",
    `    output: ${join(outputDir, "{agent.id}.md")}`,
    `  - template: ${join(fixturesDir, "templates/overview.md.hbs")}`,
    "    context: system",
    `    output: ${join(outputDir, "overview.md")}`,
  ].join("\n"));
  writeFileSync(bindingsRenderConfig, [
    `dsl: ${join(fixturesDir, "with-bindings/agent-contracts.yaml")}`,
    "bindings:",
    `  - ${join(fixturesDir, "with-bindings/binding.yaml")}`,
    "renders:",
    `  - template: ${join(fixturesDir, "with-bindings/overview-with-bindings.md.hbs")}`,
    "    context: system",
    `    output: ${join(bindingsOutputDir, "overview.md")}`,
  ].join("\n"));
});

afterAll(() => {
  if (existsSync(outputDir)) rmSync(outputDir, { recursive: true, force: true });
  if (existsSync(bindingsOutputDir)) rmSync(bindingsOutputDir, { recursive: true, force: true });
  rmSync(renderConfig, { force: true });
  rmSync(bindingsRenderConfig, { force: true });
});

describe("agent-contracts resolve", () => {
  it("outputs resolved YAML to stdout", async () => {
    const { stdout, exitCode } = await run(["resolve", minimalYaml]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("minimal-system");
  });

  it("outputs JSON with --format json", async () => {
    const { stdout, exitCode } = await run([
      "resolve", minimalYaml, "--format", "json",
    ]);
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data.system.id).toBe("minimal-system");
  });

  it("exits 1 on non-existent file", async () => {
    const { exitCode, stderr } = await run(["resolve", "/tmp/nonexistent.yaml"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Error");
  });

  it("--expand-defaults fills Zod default values", async () => {
    const { stdout, exitCode } = await run([
      "resolve", minimalYaml, "--expand-defaults", "--format", "json",
    ]);
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data.policies).toEqual({});
    expect(data.guardrails).toEqual({});
    expect(data.guardrail_policies).toEqual({});
    const agent = data.agents?.implementer;
    expect(agent).toBeDefined();
    expect(agent.can_perform_validations).toEqual([]);
  });
});

describe("agent-contracts validate", () => {
  it("exits 0 on valid minimal fixture", async () => {
    const { exitCode, stdout } = await run(["validate", minimalYaml]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("passed");
  });

  it("exits 1 on invalid fixture (bad version)", async () => {
    const { exitCode, stderr } = await run([
      "validate",
      join(fixturesDir, "invalid/wrong-version.yaml"),
    ]);
    expect(exitCode).toBe(1);
    expect(stderr.length).toBeGreaterThan(0);
  });

  it("--quiet suppresses success output", async () => {
    const { exitCode, stdout } = await run([
      "validate", minimalYaml, "--quiet",
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toBe("");
  });

  it("--format json outputs JSON diagnostics on error", async () => {
    const { exitCode, stderr } = await run([
      "validate",
      join(fixturesDir, "invalid/missing-required.yaml"),
      "--format", "json",
    ]);
    expect(exitCode).toBe(1);
    const cleaned = stderr.split("\n")
      .filter(l => !l.startsWith("(node:") && !l.startsWith("(Use "))
      .join("\n");
    const diags = JSON.parse(cleaned.trim());
    expect(Array.isArray(diags)).toBe(true);
    expect(diags.length).toBeGreaterThan(0);
  });
});

describe("agent-contracts lint", () => {
  it("exits 0 on minimal fixture", async () => {
    const { exitCode } = await run(["lint", minimalYaml]);
    expect(exitCode).toBe(0);
  });
});

describe("agent-contracts render", () => {
  it("generates rendered files", async () => {
    const { exitCode, stdout } = await run([
      "render", "--config", renderConfig,
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Rendered");
    expect(existsSync(outputDir)).toBe(true);
  });

  it("--check exits 0 when files are up to date", async () => {
    await run(["render", "--config", renderConfig]);
    const { exitCode, stdout } = await run([
      "render", "--config", renderConfig, "--check",
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("No drift");
  });

  it("--check exits 1 when files are missing", async () => {
    const emptyConfigPath = join(tmpdir(), "agc-empty-config.yaml");
    writeFileSync(emptyConfigPath, `dsl: ${minimalYaml}\nrenders:\n  - template: ${join(fixturesDir, "templates/agent-prompt.md.hbs")}\n    context: agent\n    output: ${join(tmpdir(), "agc-nonexistent/{agent.id}.md")}\n`);
    try {
      const { exitCode, stderr } = await run([
        "render", "--config", emptyConfigPath, "--check",
      ]);
      expect(exitCode).toBe(1);
      expect(stderr).toContain("Drift");
    } finally {
      rmSync(emptyConfigPath, { force: true });
    }
  });

  it("exits 1 without config", async () => {
    const { tmpdir } = await import("node:os");
    const { exitCode, stderr } = await run(["render"], { cwd: tmpdir() });
    expect(exitCode).toBe(1);
    expect(stderr).toContain("not found");
  });
});

describe("agent-contracts check", () => {
  it("runs full pipeline and exits 0 on valid fixture", async () => {
    await run(["render", "--config", renderConfig]);
    const { exitCode, stdout } = await run(["check", "--config", renderConfig]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("passed");
  });

  it("passes with bindings (no false drift)", async () => {
    await run(["render", "--config", bindingsRenderConfig]);
    const { exitCode, stdout } = await run(["check", "--config", bindingsRenderConfig]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("passed");
  });
});

describe("agent-contracts navigation-index", () => {
  it("outputs JSON navigation index", async () => {
    const { stdout, exitCode } = await run([
      "navigation-index", minimalYaml, "--format", "json",
    ]);
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data.version).toBe("1.0.0");
    expect(data.system.id).toBe("minimal-system");
    expect(data.artifacts.codebase).toBeDefined();
    expect(data.artifacts.codebase.id).toBe("codebase");
  });

  it("filters by --artifact", async () => {
    const { stdout, exitCode } = await run([
      "navigation-index", minimalYaml, "--format", "json", "--artifact", "codebase",
    ]);
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(Object.keys(data.artifacts)).toEqual(["codebase"]);
  });
});

describe("error handling", () => {
  it("shows help on unknown command", async () => {
    const { stdout } = await run(["help"]);
    expect(stdout).toContain("agent-contracts");
  });
});
