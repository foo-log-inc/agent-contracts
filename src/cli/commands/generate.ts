import { Command } from "commander";
import type { ResolvedConfig, ResolvedTeamConfig } from "../../config/types.js";
import { loadConfig, ConfigLoadError, loadBindings } from "../../config/index.js";
import { resolve, substituteVars } from "../../resolver/index.js";
import { validateSchema } from "../../validator/index.js";
import { generateGuardrails } from "../../guardrail-generator/index.js";
import {
  renderFromConfig,
  checkDriftFromConfig,
  type RenderOptions,
} from "../../renderer/index.js";
import { runGenerateInterfaceCli } from "./generate-interface.js";
import { getTeamEntries, isMultiTeamConfig } from "../multi-team.js";

const VALID_TYPES = ["templates", "guardrails", "interface"] as const;
type GenerateType = (typeof VALID_TYPES)[number];

function resolvedConfigForTeam(
  workspace: ResolvedConfig,
  teamConfig: ResolvedTeamConfig,
): ResolvedConfig {
  return {
    dsl: "",
    vars: teamConfig.vars,
    renders: workspace.renders,
    configDir: workspace.configDir,
    bindings: teamConfig.bindings,
    activeGuardrailPolicy: teamConfig.activeGuardrailPolicy,
    paths: teamConfig.paths,
  };
}

export interface GenerateOpts {
  config?: string;
  team?: string;
  check: boolean;
  binding?: string[];
  output?: string;
  format: string;
  dryRun: boolean;
  quiet: boolean;
}

export async function runGenerate(
  type: string | undefined,
  opts: GenerateOpts,
): Promise<void> {
  if (type !== undefined && !(VALID_TYPES as readonly string[]).includes(type)) {
    process.stderr.write(`Unknown generate type: ${type}\n`);
    process.exit(1);
  }

  if (opts.format !== "yaml" && opts.format !== "json") {
    process.stderr.write(
      `Invalid --format: expected yaml or json, got ${opts.format}\n`,
    );
    process.exit(1);
  }

  const normalizedType = type as GenerateType | undefined;
  const targets = {
    templates: normalizedType === undefined || normalizedType === "templates",
    guardrails: normalizedType === undefined || normalizedType === "guardrails",
    interface: normalizedType === undefined || normalizedType === "interface",
  };

  try {
    const config = await loadConfig(opts.config);
    if (!config) {
      process.stderr.write(
        "Error: agent-contracts.config.yaml not found. Use --config to specify path.\n",
      );
      process.exit(1);
    }

    if (isMultiTeamConfig(config)) {
      await runMultiTeam(config, targets, normalizedType, opts);
      return;
    }

    await runSingleTeam(config, targets, normalizedType, opts);
  } catch (err) {
    if (err instanceof ConfigLoadError) {
      process.stderr.write(`Config error: ${err.message}\n`);
      process.exit(1);
    }
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: ${msg}\n`);
    process.exit(1);
  }
}

interface Targets {
  templates: boolean;
  guardrails: boolean;
  interface: boolean;
}

async function runMultiTeam(
  config: ResolvedConfig,
  targets: Targets,
  normalizedType: string | undefined,
  opts: GenerateOpts,
): Promise<void> {
  const teamEntries = getTeamEntries(config, opts.team);
  let exitWithError = false;

  for (const [teamId, teamConfig] of teamEntries) {
    if (!opts.quiet) process.stdout.write(`\n--- Team: ${teamId} ---\n`);
    const resolved = await resolve(teamConfig.dsl);
    const data = teamConfig.vars
      ? substituteVars(resolved.data, teamConfig.vars)
      : resolved.data;
    const schemaResult = validateSchema(data);

    if (!schemaResult.success) {
      process.stderr.write(
        `Schema validation failed for team ${teamId}. Run 'agent-contracts validate' for details.\n`,
      );
      exitWithError = true;
      continue;
    }

    if (targets.templates) {
      let renderOptions: RenderOptions | undefined;
      if (teamConfig.bindings.length > 0) {
        const loadedBindings = await loadBindings(teamConfig.bindings);
        renderOptions = {
          loadedBindings,
          activeGuardrailPolicy: teamConfig.activeGuardrailPolicy,
        };
      }
      if (opts.check) {
        const drift = await checkDriftFromConfig(
          schemaResult.data!,
          config.renders,
          renderOptions,
        );
        if (drift.hasDrift) {
          process.stderr.write(
            `Drift detected for team ${teamId} in the following files:\n`,
          );
          for (const f of drift.diffs) {
            process.stderr.write(`  ${f}\n`);
          }
          exitWithError = true;
        } else if (!opts.quiet) {
          process.stdout.write("No drift detected.\n");
        }
      } else {
        const files = await renderFromConfig(
          schemaResult.data!,
          config.renders,
          renderOptions,
        );
        if (!opts.quiet) {
          process.stdout.write(`Rendered ${files.length} file(s):\n`);
          for (const f of files) {
            process.stdout.write(`  ${f}\n`);
          }
        }
      }
    }

    if (targets.interface) {
      if (schemaResult.data!.team_interface) {
        runGenerateInterfaceCli({
          dsl: schemaResult.data!,
          output: teamConfig.interfaceOutput ?? opts.output,
          dryRun: opts.dryRun,
          format: opts.format as "yaml" | "json",
          quiet: opts.quiet,
        });
      } else if (normalizedType === "interface") {
        process.stderr.write("Error: DSL has no team_interface section.\n");
        exitWithError = true;
      }
    }

    if (targets.guardrails) {
      const loadedBindings = await loadBindings(teamConfig.bindings);
      const result = await generateGuardrails({
        dsl: schemaResult.data!,
        config: resolvedConfigForTeam(config, teamConfig),
        loadedBindings,
        filterBindings: opts.binding,
        dryRun: opts.dryRun,
      });

      const errors = result.diagnostics.filter((d) => d.severity === "error");
      const warnings = result.diagnostics.filter((d) => d.severity === "warning");
      const infos = result.diagnostics.filter((d) => d.severity === "info");

      if (errors.length > 0) {
        process.stderr.write(`Errors (team ${teamId}):\n`);
        for (const d of errors) {
          process.stderr.write(`  error [${d.path}] ${d.message}\n`);
        }
        exitWithError = true;
      }

      if (warnings.length > 0 && !opts.quiet) {
        process.stderr.write(`Warnings (team ${teamId}):\n`);
        for (const d of warnings) {
          process.stderr.write(`  warning [${d.path}] ${d.message}\n`);
        }
      }

      if (infos.length > 0 && !opts.quiet) {
        for (const d of infos) {
          process.stderr.write(`  info [${d.path}] ${d.message}\n`);
        }
      }

      if (!opts.quiet) {
        const action = opts.dryRun ? "Would generate" : "Generated";
        process.stdout.write(
          `${action} ${result.outputFiles.length} file(s):\n`,
        );
        for (const f of result.outputFiles) {
          process.stdout.write(`  ${f}\n`);
        }
      }
    }
  }

  if (exitWithError) process.exit(1);
}

async function runSingleTeam(
  config: ResolvedConfig,
  targets: Targets,
  normalizedType: string | undefined,
  opts: GenerateOpts,
): Promise<void> {
  const resolved = await resolve(config.dsl);
  const data = config.vars
    ? substituteVars(resolved.data, config.vars)
    : resolved.data;
  const schemaResult = validateSchema(data);

  if (!schemaResult.success) {
    process.stderr.write(
      "Schema validation failed. Run 'agent-contracts validate' for details.\n",
    );
    process.exit(1);
  }

  let exitWithError = false;

  if (targets.templates) {
    let renderOptions: RenderOptions | undefined;
    if (config.bindings.length > 0) {
      const loadedBindings = await loadBindings(config.bindings);
      renderOptions = {
        loadedBindings,
        activeGuardrailPolicy: config.activeGuardrailPolicy,
      };
    }

    if (opts.check) {
      const drift = await checkDriftFromConfig(
        schemaResult.data!,
        config.renders,
        renderOptions,
      );
      if (drift.hasDrift) {
        process.stderr.write("Drift detected in the following files:\n");
        for (const f of drift.diffs) {
          process.stderr.write(`  ${f}\n`);
        }
        exitWithError = true;
      } else if (!opts.quiet) {
        process.stdout.write("No drift detected.\n");
      }
    } else {
      const files = await renderFromConfig(
        schemaResult.data!,
        config.renders,
        renderOptions,
      );
      if (!opts.quiet) {
        process.stdout.write(`Rendered ${files.length} file(s):\n`);
        for (const f of files) {
          process.stdout.write(`  ${f}\n`);
        }
      }
    }
  }

  if (targets.interface) {
    if (schemaResult.data!.team_interface) {
      runGenerateInterfaceCli({
        dsl: schemaResult.data!,
        output: opts.output,
        dryRun: opts.dryRun,
        format: opts.format as "yaml" | "json",
        quiet: opts.quiet,
      });
    } else if (normalizedType === "interface") {
      process.stderr.write("Error: DSL has no team_interface section.\n");
      process.exit(1);
    }
  }

  if (targets.guardrails) {
    const loadedBindings = await loadBindings(config.bindings);
    const result = await generateGuardrails({
      dsl: schemaResult.data!,
      config,
      loadedBindings,
      filterBindings: opts.binding,
      dryRun: opts.dryRun,
    });

    const errors = result.diagnostics.filter((d) => d.severity === "error");
    const warnings = result.diagnostics.filter((d) => d.severity === "warning");
    const infos = result.diagnostics.filter((d) => d.severity === "info");

    if (errors.length > 0) {
      process.stderr.write("Errors:\n");
      for (const d of errors) {
        process.stderr.write(`  error [${d.path}] ${d.message}\n`);
      }
      exitWithError = true;
    }

    if (warnings.length > 0 && !opts.quiet) {
      process.stderr.write("Warnings:\n");
      for (const d of warnings) {
        process.stderr.write(`  warning [${d.path}] ${d.message}\n`);
      }
    }

    if (infos.length > 0 && !opts.quiet) {
      for (const d of infos) {
        process.stderr.write(`  info [${d.path}] ${d.message}\n`);
      }
    }

    if (!opts.quiet) {
      const action = opts.dryRun ? "Would generate" : "Generated";
      process.stdout.write(
        `${action} ${result.outputFiles.length} file(s):\n`,
      );
      for (const f of result.outputFiles) {
        process.stdout.write(`  ${f}\n`);
      }
    }
  }

  if (exitWithError) process.exit(1);
}

export const generateCommand = new Command("generate")
  .description("Generate artifacts from DSL — templates, guardrails, and/or interface")
  .argument(
    "[type]",
    "Type of artifacts to generate (templates|guardrails|interface). Omit to run all.",
  )
  .option("-c, --config <path>", "Path to agent-contracts.config.yaml")
  .option("--team <id>", "Limit to one team (multi-team config only)")
  .option(
    "--check",
    "Check for template drift without writing files (templates only)",
    false,
  )
  .option("--binding <name...>", "Filter to specific software binding(s) (guardrails only)")
  .option(
    "-o, --output <path>",
    "Output path for generated team interface (interface only)",
  )
  .option(
    "--format <format>",
    "Output format for team interface: yaml or json",
    "yaml",
  )
  .option("--dry-run", "Print what would be generated without writing files", false)
  .option("--quiet", "Suppress output on success", false)
  .action(runGenerate);
