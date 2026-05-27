import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig, ConfigLoadError } from "../src/config/index.js";

const TEMP_DIR = join(tmpdir(), "agc-tmp-config");

beforeEach(async () => {
  await mkdir(TEMP_DIR, { recursive: true });
});

afterEach(async () => {
  await rm(TEMP_DIR, { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("loads a valid config file", async () => {
    const configPath = join(TEMP_DIR, "agent-contracts.config.yaml");
    await writeFile(
      configPath,
      `dsl: ./agent-contracts.yaml\nrenders:\n  - template: ./tpl/agent.hbs\n    context: agent\n    output: ./out/{agent.id}.md\n`,
    );

    const config = await loadConfig(configPath);
    expect(config).not.toBeNull();
    expect(config!.dsl).toBe(join(TEMP_DIR, "agent-contracts.yaml"));
    expect(config!.renders).toHaveLength(1);
    expect(config!.renders[0].context).toBe("agent");
    expect(config!.renders[0].template).toBe(join(TEMP_DIR, "tpl", "agent.hbs"));
    expect(config!.renders[0].output).toBe(join(TEMP_DIR, "out", "{agent.id}.md"));
  });

  it("throws ConfigLoadError for explicit non-existent path", async () => {
    await expect(
      loadConfig(join(TEMP_DIR, "nonexistent.yaml")),
    ).rejects.toThrow(ConfigLoadError);
  });

  it("returns null for default non-existent config", async () => {
    const originalCwd = process.cwd();
    process.chdir(TEMP_DIR);
    try {
      const result = await loadConfig(undefined);
      expect(result).toBeNull();
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("rejects invalid YAML", async () => {
    const configPath = join(TEMP_DIR, "bad.yaml");
    await writeFile(configPath, ":\n  :\n   bad yaml {{{{");
    await expect(loadConfig(configPath)).rejects.toThrow(ConfigLoadError);
  });

  it("rejects config with both include and exclude", async () => {
    const configPath = join(TEMP_DIR, "bad-filter.yaml");
    await writeFile(
      configPath,
      `dsl: ./a.yaml\nrenders:\n  - template: ./t.hbs\n    context: agent\n    output: ./out.md\n    include: [a]\n    exclude: [b]\n`,
    );
    await expect(loadConfig(configPath)).rejects.toThrow(ConfigLoadError);
  });

  it("rejects include/exclude with system context", async () => {
    const configPath = join(TEMP_DIR, "bad-system.yaml");
    await writeFile(
      configPath,
      `dsl: ./a.yaml\nrenders:\n  - template: ./t.hbs\n    context: system\n    output: ./out.md\n    include: [x]\n`,
    );
    await expect(loadConfig(configPath)).rejects.toThrow(ConfigLoadError);
  });

  it("rejects invalid context type", async () => {
    const configPath = join(TEMP_DIR, "bad-ctx.yaml");
    await writeFile(
      configPath,
      `dsl: ./a.yaml\nrenders:\n  - template: ./t.hbs\n    context: per-agent\n    output: ./out.md\n`,
    );
    await expect(loadConfig(configPath)).rejects.toThrow(ConfigLoadError);
  });

  it("accepts all valid context types", async () => {
    const types = [
      "agent",
      "task",
      "artifact",
      "tool",
      "validation",
      "handoff_type",
      "workflow",
      "policy",
      "system",
    ];

    for (const ctx of types) {
      const configPath = join(TEMP_DIR, `ctx-${ctx}.yaml`);
      const output =
        ctx === "system" ? "./out.md" : `./out/{${ctx}.id}.md`;
      await writeFile(
        configPath,
        `dsl: ./a.yaml\nrenders:\n  - template: ./t.hbs\n    context: ${ctx}\n    output: ${output}\n`,
      );
      const config = await loadConfig(configPath);
      expect(config).not.toBeNull();
      expect(config!.renders[0].context).toBe(ctx);
    }
  });

  it("loads config with vars", async () => {
    const configPath = join(TEMP_DIR, "vars.yaml");
    await writeFile(
      configPath,
      `dsl: ./agent-contracts.yaml\nvars:\n  project_name: my-app\n  language: TypeScript\nrenders:\n  - template: ./tpl/agent.hbs\n    context: agent\n    output: ./out/{agent.id}.md\n`,
    );

    const config = await loadConfig(configPath);
    expect(config).not.toBeNull();
    expect(config!.vars).toEqual({
      project_name: "my-app",
      language: "TypeScript",
    });
  });

  it("loads config without vars (optional)", async () => {
    const configPath = join(TEMP_DIR, "no-vars.yaml");
    await writeFile(
      configPath,
      `dsl: ./agent-contracts.yaml\nrenders:\n  - template: ./tpl/agent.hbs\n    context: agent\n    output: ./out/{agent.id}.md\n`,
    );

    const config = await loadConfig(configPath);
    expect(config).not.toBeNull();
    expect(config!.vars).toBeUndefined();
  });

  it("rejects non-string vars values", async () => {
    const configPath = join(TEMP_DIR, "bad-vars.yaml");
    await writeFile(
      configPath,
      `dsl: ./a.yaml\nvars:\n  count: 42\nrenders:\n  - template: ./t.hbs\n    context: agent\n    output: ./out.md\n`,
    );
    await expect(loadConfig(configPath)).rejects.toThrow(ConfigLoadError);
  });

  it("resolves relative paths from config directory", async () => {
    const subDir = join(TEMP_DIR, "sub");
    await mkdir(subDir, { recursive: true });
    const configPath = join(subDir, "agent-contracts.config.yaml");
    await writeFile(
      configPath,
      `dsl: ../data/agent-contracts.yaml\nrenders:\n  - template: ../tpl/a.hbs\n    context: agent\n    output: ../out/{agent.id}.md\n`,
    );

    const config = await loadConfig(configPath);
    expect(config!.dsl).toBe(join(TEMP_DIR, "data", "agent-contracts.yaml"));
    expect(config!.renders[0].template).toBe(join(TEMP_DIR, "tpl", "a.hbs"));
  });
});
