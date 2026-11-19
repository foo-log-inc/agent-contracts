import { matchesArtifact } from "artifact-contracts/core";
import type { ArtifactFileInfo } from "./types.js";

export function matchFileToArtifacts(
  filePath: string,
  artifacts: Record<string, ArtifactFileInfo>,
): string[] {
  return Object.entries(artifacts)
    .filter(([, art]) => matchesArtifact(filePath, art))
    .map(([id]) => id);
}
