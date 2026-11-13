import { resolve, join } from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handlers } from "../../src/cli/handlers.js";

const fixturesDir = resolve(import.meta.dirname, "../fixtures");
const minimalYaml = join(fixturesDir, "minimal/agent-contracts.yaml");

describe("handleNavigationIndex", () => {
  let stdout = "";
  let stderr = "";
  let savedExitCode: typeof process.exitCode;

  beforeEach(() => {
    stdout = "";
    stderr = "";
    savedExitCode = process.exitCode;
    process.exitCode = undefined;
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout += String(chunk);
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderr += String(chunk);
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = savedExitCode;
  });

  it("outputs JSON navigation index for minimal fixture", async () => {
    await handlers.navigationIndex(minimalYaml, { format: "json" }, {});

    const data = JSON.parse(stdout);
    expect(data.version).toBe("1.0.0");
    expect(data.system.id).toBe("minimal-system");
    expect(data.artifacts.codebase).toBeDefined();
    expect(data.artifacts.codebase.id).toBe("codebase");
    expect(data.artifacts.codebase.agents.editors).toContain("implementer");
  });

  it("filters output to a single artifact", async () => {
    await handlers.navigationIndex(
      minimalYaml,
      { format: "json", artifact: "codebase" },
      {},
    );

    const data = JSON.parse(stdout);
    expect(Object.keys(data.artifacts)).toEqual(["codebase"]);
  });

  it("outputs YAML when --format yaml", async () => {
    await handlers.navigationIndex(minimalYaml, { format: "yaml" }, {});

    expect(stdout).toContain("version:");
    expect(stdout).toContain("codebase:");
    expect(stdout).toContain("minimal-system");
  });

  it("exits 1 when artifact is not found", async () => {
    await handlers.navigationIndex(
      minimalYaml,
      { format: "json", artifact: "nonexistent" },
      {},
    );

    expect(process.exitCode).toBe(1);
    expect(stderr).toContain("Artifact not found: nonexistent");
  });
});
