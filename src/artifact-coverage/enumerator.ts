import { execSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { minimatch } from "minimatch";

export function enumerateProjectFiles(
  cwd: string,
  excludePatterns: string[],
): string[] {
  const filePaths = listFiles(cwd);

  if (excludePatterns.length === 0) {
    return filePaths;
  }

  return filePaths.filter(
    (f) => !excludePatterns.some((p) => minimatch(f, p, { dot: true })),
  );
}

function listFiles(cwd: string): string[] {
  try {
    const output = execSync("git ls-files", {
      encoding: "utf-8",
      cwd,
    });
    return output.trim().split("\n").filter(Boolean);
  } catch {
    return walkDir(cwd, cwd);
  }
}

const IGNORE_DIRS = new Set(["node_modules", ".git", "dist", ".next", "coverage"]);

function walkDir(root: string, dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      results.push(...walkDir(root, join(dir, entry.name)));
    } else {
      const rel = join(dir, entry.name).slice(root.length + 1).replace(/\\/g, "/");
      results.push(rel);
    }
  }
  return results;
}
