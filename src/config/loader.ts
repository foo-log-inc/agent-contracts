import { readFile, access } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  AgentContractsConfigSchema,
  type ResolvedArtifactBinding,
  type ResolvedConfig,
  type ResolvedTeamConfig,
  type TeamConfig,
  type ArtifactBindingConfig,
} from "./types.js";

const DEFAULT_CONFIG_NAME = "agent-contracts.config.yaml";

export class ConfigLoadError extends Error {
  constructor(
    message: string,
    public readonly filePath?: string,
  ) {
    super(message);
    this.name = "ConfigLoadError";
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function resolveArtifactBindingConfig(
  binding: ArtifactBindingConfig | undefined,
  configDir: string,
): ResolvedArtifactBinding | undefined {
  if (binding === undefined) {
    return undefined;
  }

  if (typeof binding === "string") {
    return { source: resolve(configDir, binding) };
  }

  return {
    source: resolve(configDir, binding.source),
    mappings: binding.mappings,
  };
}

function resolveTeamConfigs(
  teams: Record<string, TeamConfig>,
  configDir: string,
): Record<string, ResolvedTeamConfig> {
  const defaults = teams._defaults;
  const result: Record<string, ResolvedTeamConfig> = {};

  for (const [key, team] of Object.entries(teams)) {
    if (key === "_defaults") continue;

    const mergedBindings = [...(defaults?.bindings ?? []), ...team.bindings].map(
      (b) => resolve(configDir, b),
    );

    const mergedVars =
      defaults?.vars || team.vars
        ? { ...(defaults?.vars ?? {}), ...(team.vars ?? {}) }
        : undefined;

    const mergedPaths =
      defaults?.paths || team.paths
        ? { ...(defaults?.paths ?? {}), ...(team.paths ?? {}) }
        : undefined;

    result[key] = {
      dsl: resolve(configDir, team.dsl!),
      bindings: mergedBindings,
      vars: mergedVars,
      activeGuardrailPolicy:
        team.active_guardrail_policy ?? defaults?.active_guardrail_policy,
      paths: mergedPaths,
      interfaceOutput: team.interface_output
        ? resolve(configDir, team.interface_output)
        : undefined,
      artifactBinding: resolveArtifactBindingConfig(
        team.artifact_binding ?? defaults?.artifact_binding,
        configDir,
      ),
    };
  }

  return result;
}

export async function loadConfig(
  configPath?: string,
): Promise<ResolvedConfig | null> {
  const isExplicit = configPath !== undefined;
  const targetPath = resolve(configPath ?? DEFAULT_CONFIG_NAME);

  if (!(await fileExists(targetPath))) {
    if (isExplicit) {
      throw new ConfigLoadError(
        `Config file not found: ${targetPath}`,
        targetPath,
      );
    }
    return null;
  }

  let content: string;
  try {
    content = await readFile(targetPath, "utf8");
  } catch {
    throw new ConfigLoadError(
      `Failed to read config file: ${targetPath}`,
      targetPath,
    );
  }

  let raw: unknown;
  try {
    raw = parseYaml(content);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ConfigLoadError(
      `Invalid YAML syntax in ${targetPath}: ${msg}`,
      targetPath,
    );
  }

  const result = AgentContractsConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new ConfigLoadError(
      `Invalid config in ${targetPath}:\n${issues}`,
      targetPath,
    );
  }

  const configDir = dirname(targetPath);
  const config = result.data;

  const renders = config.renders.map((r) => ({
    ...r,
    template: resolve(configDir, r.template),
    output: resolve(configDir, r.output),
  }));

  if (config.teams) {
    return {
      dsl: "",
      vars: undefined,
      renders,
      configDir,
      bindings: [],
      activeGuardrailPolicy: undefined,
      paths: undefined,
      teams: resolveTeamConfigs(config.teams, configDir),
      audit: config.audit ?? undefined,
      artifactCoverage: config.artifact_coverage ?? undefined,
    };
  }

  return {
    dsl: resolve(configDir, config.dsl!),
    vars: config.vars,
    renders,
    configDir,
    bindings: (config.bindings ?? []).map((b) => resolve(configDir, b)),
    activeGuardrailPolicy: config.active_guardrail_policy,
    paths: config.paths,
    audit: config.audit ?? undefined,
    artifactCoverage: config.artifact_coverage ?? undefined,
    artifactBinding: resolveArtifactBindingConfig(config.artifact_binding, configDir),
  };
}

export function resolveDslPath(
  dirArg: string | undefined,
  dirArgDefault: string,
  config: ResolvedConfig | null,
): string {
  if (dirArg !== undefined && dirArg !== dirArgDefault) {
    return resolve(dirArg);
  }
  if (config) {
    return config.dsl;
  }
  return resolve(dirArgDefault);
}
