import { describe, it, expect } from "vitest";
import { matchFileToArtifacts } from "../../src/artifact-coverage/matcher.js";
import type { ArtifactFileInfo } from "../../src/artifact-coverage/types.js";

const artifacts: Record<string, ArtifactFileInfo> = {
  "core-lib": {
    path_patterns: ["src/core/**/*.ts"],
    exclude_patterns: ["src/core/__tests__/**"],
  },
  "test-code": {
    path_patterns: ["src/**/__tests__/**/*.ts", "test/**/*.ts"],
    exclude_patterns: [],
  },
  config: {
    path_patterns: ["*.config.ts", "*.config.yaml"],
    exclude_patterns: [],
  },
};

describe("matchFileToArtifacts", () => {
  it("matches a file to a single artifact", () => {
    const result = matchFileToArtifacts("src/core/db.ts", artifacts);
    expect(result).toEqual(["core-lib"]);
  });

  it("respects exclude_patterns", () => {
    const result = matchFileToArtifacts("src/core/__tests__/db.test.ts", artifacts);
    expect(result).not.toContain("core-lib");
    expect(result).toContain("test-code");
  });

  it("returns empty array for unmatched files", () => {
    const result = matchFileToArtifacts("scripts/deploy.sh", artifacts);
    expect(result).toEqual([]);
  });

  it("returns multiple artifacts for overlapping patterns", () => {
    const overlapping: Record<string, ArtifactFileInfo> = {
      "all-src": {
        path_patterns: ["src/**/*.ts"],
        exclude_patterns: [],
      },
      "core-only": {
        path_patterns: ["src/core/**/*.ts"],
        exclude_patterns: [],
      },
    };
    const result = matchFileToArtifacts("src/core/index.ts", overlapping);
    expect(result).toHaveLength(2);
    expect(result).toContain("all-src");
    expect(result).toContain("core-only");
  });

  it("normalizes backslashes", () => {
    const result = matchFileToArtifacts("src\\core\\db.ts", artifacts);
    expect(result).toEqual(["core-lib"]);
  });

  it("matches config files at root", () => {
    const result = matchFileToArtifacts("vitest.config.ts", artifacts);
    expect(result).toEqual(["config"]);
  });
});
