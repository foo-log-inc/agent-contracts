import { describe, it, expect, vi } from "vitest";
import { enumerateProjectFiles } from "../../src/artifact-coverage/enumerator.js";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

import { execSync } from "node:child_process";
const mockExecSync = vi.mocked(execSync);

describe("enumerateProjectFiles", () => {
  it("parses git ls-files output", () => {
    mockExecSync.mockReturnValue("src/a.ts\nsrc/b.ts\nREADME.md\n");

    const files = enumerateProjectFiles("/project", []);
    expect(files).toEqual(["src/a.ts", "src/b.ts", "README.md"]);
  });

  it("filters out files matching exclude patterns", () => {
    mockExecSync.mockReturnValue("src/a.ts\npackage-lock.json\nfoo.snap\n");

    const files = enumerateProjectFiles("/project", ["**/*-lock.json", "**/*.snap"]);
    expect(files).toEqual(["src/a.ts"]);
  });

  it("handles empty git output", () => {
    mockExecSync.mockReturnValue("");

    const files = enumerateProjectFiles("/project", []);
    expect(files).toEqual([]);
  });

  it("applies multiple exclude patterns", () => {
    mockExecSync.mockReturnValue(
      "src/a.ts\n.cursor/rules/foo.mdc\ntest/__snapshots__/x.snap\nindex.ts\n",
    );

    const files = enumerateProjectFiles("/project", [
      ".cursor/**",
      "**/__snapshots__/**",
    ]);
    expect(files).toEqual(["src/a.ts", "index.ts"]);
  });
});
