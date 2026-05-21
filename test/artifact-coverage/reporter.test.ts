import { describe, it, expect } from "vitest";
import { buildCoverageReport, formatCoverageText } from "../../src/artifact-coverage/reporter.js";
import type { ArtifactFileInfo } from "../../src/artifact-coverage/types.js";

const artifacts: Record<string, ArtifactFileInfo> = {
  "core-lib": {
    path_patterns: ["src/core/**/*.ts"],
    exclude_patterns: ["src/core/__tests__/**"],
  },
  "test-code": {
    path_patterns: ["test/**/*.ts"],
    exclude_patterns: [],
  },
};

describe("buildCoverageReport", () => {
  it("computes correct summary for fully covered files", () => {
    const files = ["src/core/db.ts", "src/core/model.ts", "test/db.test.ts"];
    const report = buildCoverageReport(files, artifacts);

    expect(report.summary.total_files).toBe(3);
    expect(report.summary.covered_files).toBe(3);
    expect(report.summary.uncovered_files).toBe(0);
    expect(report.summary.coverage_percent).toBe(100);
  });

  it("identifies uncovered files", () => {
    const files = ["src/core/db.ts", "scripts/deploy.sh", "README.md"];
    const report = buildCoverageReport(files, artifacts);

    expect(report.summary.uncovered_files).toBe(2);
    expect(report.uncovered).toContain("README.md");
    expect(report.uncovered).toContain("scripts/deploy.sh");
  });

  it("identifies overlapping files", () => {
    const overlapping: Record<string, ArtifactFileInfo> = {
      broad: { path_patterns: ["src/**/*.ts"], exclude_patterns: [] },
      narrow: { path_patterns: ["src/core/**/*.ts"], exclude_patterns: [] },
    };
    const files = ["src/core/index.ts"];
    const report = buildCoverageReport(files, overlapping);

    expect(report.summary.overlapping_files).toBe(1);
    expect(report.overlapping[0].path).toBe("src/core/index.ts");
    expect(report.overlapping[0].artifacts).toEqual(["broad", "narrow"]);
  });

  it("computes per-artifact matched_files", () => {
    const files = ["src/core/a.ts", "src/core/b.ts", "test/a.test.ts"];
    const report = buildCoverageReport(files, artifacts);

    expect(report.per_artifact["core-lib"].matched_files).toBe(2);
    expect(report.per_artifact["test-code"].matched_files).toBe(1);
  });

  it("handles empty file list", () => {
    const report = buildCoverageReport([], artifacts);

    expect(report.summary.total_files).toBe(0);
    expect(report.summary.coverage_percent).toBe(100);
  });

  it("handles empty artifacts", () => {
    const files = ["src/core/db.ts", "README.md"];
    const report = buildCoverageReport(files, {});

    expect(report.summary.total_files).toBe(2);
    expect(report.summary.covered_files).toBe(0);
    expect(report.summary.uncovered_files).toBe(2);
    expect(report.summary.coverage_percent).toBe(0);
  });
});

describe("formatCoverageText", () => {
  it("produces human-readable output", () => {
    const files = ["src/core/db.ts", "scripts/deploy.sh"];
    const report = buildCoverageReport(files, artifacts);
    const text = formatCoverageText(report);

    expect(text).toContain("=== Artifact Coverage ===");
    expect(text).toContain("Total files:");
    expect(text).toContain("Covered:");
    expect(text).toContain("Uncovered:");
    expect(text).toContain("scripts/deploy.sh");
  });

  it("omits uncovered section when everything is covered", () => {
    const files = ["src/core/db.ts"];
    const report = buildCoverageReport(files, artifacts);
    const text = formatCoverageText(report);

    expect(text).not.toContain("--- Uncovered files ---");
  });
});
