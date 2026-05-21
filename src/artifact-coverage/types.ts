export interface ArtifactCoverageSummary {
  total_files: number;
  covered_files: number;
  uncovered_files: number;
  overlapping_files: number;
  coverage_percent: number;
}

export interface OverlappingFile {
  path: string;
  artifacts: string[];
}

export interface PerArtifactEntry {
  matched_files: number;
  patterns: string[];
}

export interface ArtifactCoverageReport {
  summary: ArtifactCoverageSummary;
  uncovered: string[];
  overlapping: OverlappingFile[];
  per_artifact: Record<string, PerArtifactEntry>;
}

export interface ArtifactFileInfo {
  path_patterns: string[];
  exclude_patterns: string[];
}
