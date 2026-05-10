import { Command } from "commander";
import { loadConfig, loadBindings, ConfigLoadError } from "../../config/index.js";
import { resolve, substituteVars } from "../../resolver/index.js";
import { validateSchema } from "../../validator/index.js";
import {
  runAudit,
  runAllAudits,
  formatAuditResult,
  formatAuditResults,
  computeExitCode,
} from "../../auditor/index.js";
import type { AuditType, AuditConfig, OutputFormat } from "../../auditor/index.js";
import { getTeamEntries, isMultiTeamConfig } from "../multi-team.js";

const AUDIT_TYPES = ["render", "dsl", "prompt", "all"] as const;

function parseAuditConfig(config: Record<string, unknown> | undefined): AuditConfig {
  if (!config) return {};
  const audit = config as Record<string, unknown>;
  return {
    adapter: audit.adapter as string | undefined,
    model: audit.model as string | undefined,
    temperature: audit.temperature as number | undefined,
    cache_dir: audit.cache_dir as string | undefined,
  };
}

async function runAuditForDsl(
  dslPath: string,
  vars: Record<string, string> | undefined,
  configObj: Awaited<ReturnType<typeof loadConfig>> & object,
  auditType: string,
  opts: { format: OutputFormat; scope?: string; dryRun: boolean; adapter?: string; model?: string },
): Promise<number> {
  const resolved = await resolve(dslPath);
  const data = vars ? substituteVars(resolved.data, vars) : resolved.data;
  const schemaResult = validateSchema(data);

  if (!schemaResult.success) {
    process.stderr.write("Schema validation failed. Run 'agent-contracts validate' first.\n");
    return 2;
  }

  const auditConfig = parseAuditConfig(
    (configObj as Record<string, unknown>).audit as Record<string, unknown> | undefined,
  );
  if (opts.adapter) auditConfig.adapter = opts.adapter;
  if (opts.model) auditConfig.model = opts.model;

  if (auditType === "all") {
    const results = await runAllAudits(schemaResult.data!, configObj, auditConfig, {
      format: opts.format,
      scope: opts.scope,
      dryRun: opts.dryRun,
    });

    if (opts.dryRun) {
      for (const r of results) {
        process.stdout.write(`\n--- Audit prompt: ${r.auditType} ---\n`);
        process.stdout.write(r.prompt + "\n");
      }
    } else {
      process.stdout.write(formatAuditResults(results, opts.format) + "\n");
    }
    return computeExitCode(results);
  }

  const result = await runAudit(schemaResult.data!, configObj, auditConfig, {
    auditType: auditType as AuditType,
    format: opts.format,
    scope: opts.scope,
    dryRun: opts.dryRun,
  });

  if (opts.dryRun) {
    process.stdout.write(result.prompt + "\n");
  } else {
    process.stdout.write(formatAuditResult(result, opts.format) + "\n");
  }

  return computeExitCode([result]);
}

export const auditCommand = new Command("audit")
  .description("Run LLM-based semantic audit on DSL definitions and generated outputs")
  .argument("[type]", `Audit type: ${AUDIT_TYPES.join(", ")}`, "all")
  .option("-c, --config <path>", "Path to agent-contracts.config.yaml")
  .option("--team <id>", "Limit to one team (multi-team config only)")
  .option("--format <format>", "Output format (text|json|markdown)", "text")
  .option("--scope <entities>", "Limit audit scope (e.g. agents:architect,implementer)")
  .option("--dry-run", "Output the audit prompt without calling LLM", false)
  .option("--adapter <name>", "SDK adapter to use (default from config)")
  .option("--model <name>", "LLM model override")
  .action(
    async (
      type: string,
      opts: {
        config?: string;
        team?: string;
        format: string;
        scope?: string;
        dryRun: boolean;
        adapter?: string;
        model?: string;
      },
    ) => {
      if (!AUDIT_TYPES.includes(type as (typeof AUDIT_TYPES)[number])) {
        process.stderr.write(
          `Unknown audit type: "${type}". Use one of: ${AUDIT_TYPES.join(", ")}\n`,
        );
        process.exit(2);
      }

      const format = opts.format as OutputFormat;

      try {
        const config = await loadConfig(opts.config);
        if (!config) {
          process.stderr.write(
            "Error: agent-contracts.config.yaml not found. Use --config to specify path.\n",
          );
          process.exit(2);
        }

        if (isMultiTeamConfig(config)) {
          const teamEntries = getTeamEntries(config, opts.team);
          let maxExit = 0;
          for (const [teamId, teamConfig] of teamEntries) {
            process.stderr.write(`\n--- Team: ${teamId} ---\n`);
            const exitCode = await runAuditForDsl(
              teamConfig.dsl,
              teamConfig.vars,
              config,
              type,
              { format, scope: opts.scope, dryRun: opts.dryRun, adapter: opts.adapter, model: opts.model },
            );
            if (exitCode > maxExit) maxExit = exitCode;
          }
          process.exit(maxExit);
        }

        const exitCode = await runAuditForDsl(
          config.dsl,
          config.vars,
          config,
          type,
          { format, scope: opts.scope, dryRun: opts.dryRun, adapter: opts.adapter, model: opts.model },
        );
        process.exit(exitCode);
      } catch (err) {
        if (err instanceof ConfigLoadError) {
          process.stderr.write(`Config error: ${err.message}\n`);
          process.exit(2);
        }
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`Error: ${msg}\n`);
        process.exit(err instanceof Error && msg.includes("not installed") ? 3 : 2);
      }
    },
  );
