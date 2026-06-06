import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync, execFileSync } from "node:child_process";
import { mkdtempSync, cpSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = join(__dirname, "..", "..");
const BUNDLE_PATH = join(ROOT, "dist", "agent-contracts.bundle.mjs");

describe("bundle-isolation", () => {
  let tempDir: string;

  beforeAll(() => {
    if (!existsSync(BUNDLE_PATH)) {
      execSync("node esbuild.bundle.mjs", { cwd: ROOT });
    }

    tempDir = mkdtempSync(join(tmpdir(), "agent-contracts-test-"));
    cpSync(BUNDLE_PATH, join(tempDir, "agent-contracts.bundle.mjs"));

    if (existsSync(join(ROOT, "agent-contracts.config.yaml"))) {
      cpSync(join(ROOT, "agent-contracts.config.yaml"), join(tempDir, "agent-contracts.config.yaml"));
    }
    if (existsSync(join(ROOT, "dsl_base"))) {
      cpSync(join(ROOT, "dsl_base"), join(tempDir, "dsl_base"), { recursive: true });
    }
    if (existsSync(join(ROOT, "sample"))) {
      cpSync(join(ROOT, "sample"), join(tempDir, "sample"), { recursive: true });
    }

    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ name: "bundle-test", version: "1.0.0", type: "module" }),
    );

    execSync("npm install @openai/agents --legacy-peer-deps", {
      cwd: tempDir,
      stdio: "pipe",
    });
  }, 60_000);

  afterAll(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("starts without agent-contracts-runtime installed globally", () => {
    const output = execFileSync("node", ["agent-contracts.bundle.mjs", "--version"], {
      cwd: tempDir,
      encoding: "utf8",
    });
    expect(output.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("constructs LLM prompt from isolated directory (--show-prompt)", () => {
    const result = execFileSync(
      "node",
      ["agent-contracts.bundle.mjs", "audit", "--adapter", "openai", "--show-prompt"],
      {
        cwd: tempDir,
        encoding: "utf8",
        timeout: 10_000,
      },
    );
    expect(result).toBeTruthy();
    expect(result.length).toBeGreaterThan(100);
  }, 30_000);

  it("runs LLM audit with openai adapter", () => {
    if (!process.env.OPENAI_API_KEY || !process.env.CI_BUNDLE_LLM_TEST) {
      return;
    }

    const output = execFileSync(
      "node",
      ["agent-contracts.bundle.mjs", "audit", "--adapter", "openai"],
      {
        cwd: tempDir,
        encoding: "utf8",
        timeout: 120_000,
        env: { ...process.env, NODE_ENV: "test" },
      },
    );
    expect(output).toBeTruthy();
  }, 130_000);
});
