export { enumerateProjectFiles } from "./enumerator.js";
export { matchFileToArtifacts } from "./matcher.js";
export { buildCoverageReport, formatCoverageText } from "./reporter.js";
export type {
  ArtifactCoverageReport,
  ArtifactCoverageSummary,
  ArtifactFileInfo,
  OverlappingFile,
  PerArtifactEntry,
} from "./types.js";
