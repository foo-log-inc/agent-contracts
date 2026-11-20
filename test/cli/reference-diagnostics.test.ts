import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handlers } from "../../src/cli/handlers.js";

const minimalYaml = resolve(import.meta.dirname, "../fixtures/minimal/agent-contracts.yaml");

describe("lint and check report a broken reference once, from checkReferences", () => {
  let dir: string;
  let dslPath: string;
  let configPath: string;
  let stderr = "";
  let savedExitCode: typeof process.exitCode;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "agc-ref-diags-"));
    dslPath = join(dir, "agent-contracts.yaml");
    writeFileSync(
      dslPath,
      readFileSync(minimalYaml, "utf8").replace(
        "    can_read_artifacts:\n      - codebase\n",
        "    can_read_artifacts:\n      - codebase\n      - ghost\n",
      ),
    );
    configPath = join(dir, "agent-contracts.config.yaml");
    writeFileSync(configPath, `dsl: ${dslPath}\nrenders: []\n`);

    stderr = "";
    savedExitCode = process.exitCode;
    process.exitCode = undefined;
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderr += String(chunk);
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = savedExitCode;
    rmSync(dir, { recursive: true, force: true });
  });

  it("lint reports the reference with the checkReferences code and severity", async () => {
    expect(readFileSync(dslPath, "utf8")).toContain("- ghost");
    await handlers.lint(dslPath, { format: "json" }, {});

    const diags = JSON.parse(stderr) as Array<Record<string, unknown>>;
    const ghost = diags.filter((d) => String(d.message).includes("ghost"));
    expect(ghost).toEqual([
      {
        path: "agents.implementer.can_read_artifacts",
        message: 'Reference "ghost" not found in artifacts',
        code: "reference-not-found",
        severity: "error",
      },
    ]);
    expect(process.exitCode).toBe(1);
  });

  it("check reports the reference once", async () => {
    await handlers.check({ config: configPath }, {});

    const lines = stderr.split("\n").filter((l) => l.includes("ghost"));
    expect(lines).toEqual([
      'agents.implementer.can_read_artifacts: error [reference-not-found] Reference "ghost" not found in artifacts',
    ]);
    expect(process.exitCode).toBe(1);
  });
});
