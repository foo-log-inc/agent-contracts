import type {
  ArtifactCoverageReport,
  ArtifactFileInfo,
  OverlappingFile,
  PerArtifactEntry,
} from "./types.js";
import { matchFileToArtifacts } from "./matcher.js";

export function buildCoverageReport(
  files: string[],
  artifacts: Record<string, ArtifactFileInfo>,
): ArtifactCoverageReport {
  const uncovered: string[] = [];
  const overlapping: OverlappingFile[] = [];
  const artifactHits: Record<string, number> = {};

  for (const id of Object.keys(artifacts)) {
    artifactHits[id] = 0;
  }

  for (const file of files) {
    const matches = matchFileToArtifacts(file, artifacts);
    if (matches.length === 0) {
      uncovered.push(file);
    } else if (matches.length > 1) {
      overlapping.push({ path: file, artifacts: matches });
    }
    for (const id of matches) {
      artifactHits[id] = (artifactHits[id] ?? 0) + 1;
    }
  }

  const totalFiles = files.length;
  const coveredFiles = totalFiles - uncovered.length;
  const coveragePercent =
    totalFiles === 0 ? 100 : Math.round((coveredFiles / totalFiles) * 1000) / 10;

  const perArtifact: Record<string, PerArtifactEntry> = {};
  for (const [id, info] of Object.entries(artifacts)) {
    perArtifact[id] = {
      matched_files: artifactHits[id] ?? 0,
      patterns: info.path_patterns,
    };
  }

  return {
    summary: {
      total_files: totalFiles,
      covered_files: coveredFiles,
      uncovered_files: uncovered.length,
      overlapping_files: overlapping.length,
      coverage_percent: coveragePercent,
    },
    uncovered: uncovered.sort(),
    overlapping: overlapping.sort((a, b) => a.path.localeCompare(b.path)),
    per_artifact: perArtifact,
  };
}

export function formatCoverageText(report: ArtifactCoverageReport): string {
  const { summary } = report;
  const lines: string[] = [];

  lines.push("=== Artifact Coverage ===");
  lines.push("");
  lines.push(`Total files:     ${summary.total_files}`);
  lines.push(
    `Covered:         ${summary.covered_files} (${summary.coverage_percent}%)`,
  );
  lines.push(
    `Uncovered:       ${summary.uncovered_files} (${(100 - summary.coverage_percent).toFixed(1)}%)`,
  );
  lines.push(
    `Overlapping:     ${summary.overlapping_files} (${summary.total_files === 0 ? 0 : ((summary.overlapping_files / summary.total_files) * 100).toFixed(1)}%)`,
  );

  if (report.uncovered.length > 0) {
    const byDir = groupByDirectory(report.uncovered);
    lines.push("");
    lines.push("--- Uncovered files (by directory) ---");
    for (const [dir, count] of byDir.slice(0, 10)) {
      lines.push(`${dir.padEnd(20)} ${count} file${count > 1 ? "s" : ""}`);
    }
    if (byDir.length > 10) {
      lines.push(`... and ${byDir.length - 10} more directories`);
    }

    lines.push("");
    lines.push("--- Uncovered files ---");
    for (const f of report.uncovered) {
      lines.push(f);
    }
  }

  if (report.overlapping.length > 0) {
    lines.push("");
    lines.push("--- Overlapping files ---");
    for (const o of report.overlapping) {
      lines.push(`${o.path}  [${o.artifacts.join(", ")}]`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

function groupByDirectory(files: string[]): [string, number][] {
  const dirs: Record<string, number> = {};
  for (const f of files) {
    const parts = f.split("/");
    const dir = parts.length > 1 ? parts.slice(0, -1).join("/") + "/" : "./";
    dirs[dir] = (dirs[dir] ?? 0) + 1;
  }
  return Object.entries(dirs).sort((a, b) => b[1] - a[1]);
}
