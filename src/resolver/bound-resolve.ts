import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { ConfigLoadError } from "../config/loader.js";
import {
  resolveArtifactBinding,
  type ArtifactBindingDiagnostic,
} from "./artifact-binding.js";

export interface BoundResolveOptions {
  artifactBinding?: {
    source: string;
    mappings?: Record<string, string>;
  };
  paths?: Record<string, string>;
}

export interface BoundResolveResult {
  data: Record<string, unknown>;
  diagnostics: ArtifactBindingDiagnostic[];
}

export async function resolveBound(
  resolvedDsl: Record<string, unknown>,
  options: BoundResolveOptions,
): Promise<BoundResolveResult> {
  if (!options.artifactBinding) {
    return { data: resolvedDsl, diagnostics: [] };
  }

  const sourcePath = options.artifactBinding.source;
  let content: string;
  try {
    content = await readFile(sourcePath, "utf8");
  } catch {
    throw new ConfigLoadError(
      `Failed to read artifact binding file: ${sourcePath}`,
      sourcePath,
    );
  }

  let raw: unknown;
  try {
    raw = parseYaml(content);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ConfigLoadError(
      `Invalid YAML syntax in artifact binding file ${sourcePath}: ${msg}`,
      sourcePath,
    );
  }

  const parsed = raw as Record<string, unknown>;
  const registryArtifacts = (parsed.artifacts ?? {}) as Record<string, unknown>;
  const dslArtifacts = (resolvedDsl.artifacts ?? {}) as Record<string, unknown>;

  const bindingResult = resolveArtifactBinding(
    dslArtifacts,
    { artifacts: registryArtifacts },
    options.artifactBinding.mappings,
    options.paths,
  );

  return {
    data: {
      ...resolvedDsl,
      artifacts: bindingResult.artifacts,
    },
    diagnostics: bindingResult.diagnostics,
  };
}
