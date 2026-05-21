import { minimatch } from "minimatch";
import type { ArtifactFileInfo } from "./types.js";

export function matchFileToArtifacts(
  filePath: string,
  artifacts: Record<string, ArtifactFileInfo>,
): string[] {
  const normalized = filePath.replace(/\\/g, "/");

  return Object.entries(artifacts)
    .filter(([, art]) => {
      const included = art.path_patterns.some((p) =>
        minimatch(normalized, p, { dot: true }),
      );
      if (!included) return false;
      if (art.exclude_patterns.length === 0) return true;
      return !art.exclude_patterns.some((p) =>
        minimatch(normalized, p, { dot: true }),
      );
    })
    .map(([id]) => id);
}
