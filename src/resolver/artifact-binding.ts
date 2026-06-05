export interface ArtifactBindingDiagnostic {
  severity: "warning" | "error";
  rule: "unbound-artifact" | "orphan-binding" | "type-mismatch";
  message: string;
}

export interface ArtifactBindingResult {
  artifacts: Record<string, unknown>;
  diagnostics: ArtifactBindingDiagnostic[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepMerge(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, overlayValue] of Object.entries(overlay)) {
    const baseValue = result[key];
    if (isPlainObject(baseValue) && isPlainObject(overlayValue)) {
      result[key] = deepMerge(baseValue, overlayValue);
    } else {
      result[key] = overlayValue;
    }
  }
  return result;
}

function substitutePathPatterns(
  artifact: Record<string, unknown>,
  paths?: Record<string, string>,
): Record<string, unknown> {
  if (!paths) {
    return artifact;
  }

  const pathPatterns = artifact.path_patterns;
  if (!Array.isArray(pathPatterns)) {
    return artifact;
  }

  const substituted = pathPatterns.map((pattern) => {
    if (typeof pattern !== "string") {
      return pattern;
    }
    return pattern.replace(/\{(\w+)\}/g, (match, varName: string) => {
      return paths[varName] ?? match;
    });
  });

  return { ...artifact, path_patterns: substituted };
}

function asArtifactRecord(value: unknown): Record<string, unknown> | undefined {
  if (isPlainObject(value)) {
    return value;
  }
  return undefined;
}

function checkTypeMismatch(
  dslArtifactId: string,
  dslArtifact: Record<string, unknown>,
  registryArtifact: Record<string, unknown>,
): ArtifactBindingDiagnostic | undefined {
  for (const field of ["type", "authority"] as const) {
    const dslValue = dslArtifact[field];
    const registryValue = registryArtifact[field];
    if (
      dslValue !== undefined &&
      registryValue !== undefined &&
      dslValue !== registryValue
    ) {
      return {
        severity: "warning",
        rule: "type-mismatch",
        message:
          `Artifact "${dslArtifactId}" has conflicting ${field}: ` +
          `DSL="${String(dslValue)}" vs registry="${String(registryValue)}"`,
      };
    }
  }
  return undefined;
}

export function resolveArtifactBinding(
  dslArtifacts: Record<string, unknown>,
  registry: { artifacts: Record<string, unknown> },
  mappings?: Record<string, string>,
  paths?: Record<string, string>,
): ArtifactBindingResult {
  const diagnostics: ArtifactBindingDiagnostic[] = [];
  const mergedArtifacts: Record<string, unknown> = {};
  const usedRegistryIds = new Set<string>();

  for (const [dslArtifactId, dslArtifactRaw] of Object.entries(dslArtifacts)) {
    const dslArtifact = asArtifactRecord(dslArtifactRaw) ?? {};
    const registryId = mappings?.[dslArtifactId] ?? dslArtifactId;
    const registryArtifact = asArtifactRecord(registry.artifacts[registryId]);

    if (registryArtifact) {
      usedRegistryIds.add(registryId);

      const mismatch = checkTypeMismatch(
        dslArtifactId,
        dslArtifact,
        registryArtifact,
      );
      if (mismatch) {
        diagnostics.push(mismatch);
      }

      const merged = deepMerge(dslArtifact, registryArtifact);
      mergedArtifacts[dslArtifactId] = substitutePathPatterns(merged, paths);
    } else {
      diagnostics.push({
        severity: "warning",
        rule: "unbound-artifact",
        message:
          `DSL artifact "${dslArtifactId}" has no matching registry artifact ` +
          `(mapped to "${registryId}")`,
      });
      mergedArtifacts[dslArtifactId] = substitutePathPatterns(
        { ...dslArtifact },
        paths,
      );
    }
  }

  for (const registryId of Object.keys(registry.artifacts)) {
    if (!usedRegistryIds.has(registryId)) {
      diagnostics.push({
        severity: "warning",
        rule: "orphan-binding",
        message:
          `Registry artifact "${registryId}" is not mapped to any DSL artifact`,
      });
    }
  }

  return { artifacts: mergedArtifacts, diagnostics };
}
