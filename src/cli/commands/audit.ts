import { writeFileSync } from "node:fs";
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

interface AuditDslResult {
  exitCode: number;
  output: string;
}

async function runAuditForDsl(
  dslPath: string,
  vars: Record<string, string> | undefined,
  configObj: Awaited<ReturnType<typeof loadConfig>> & object,
  auditType: string,
  opts: { format: OutputFormat; scope?: string; dryRun: boolean; adapter?: string; model?: string },
  failOn?: string,
): Promise<AuditDslResult> {
  const resolved = await resolve(dslPath);
  const data = vars ? substituteVars(resolved.data, vars) : resolved.data;
  const schemaResult = validateSchema(data);

  if (!schemaResult.success) {
    process.stderr.write("Schema validation failed. Run 'agent-contracts validate' first.\n");
    return { exitCode: 1, output: "" };
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

    let output: string;
    if (opts.dryRun) {
      output = results.map((r) =>
        `\n--- Audit prompt: ${r.auditType} ---\n${r.prompt}\n`,
      ).join("");
    } else {
      output = formatAuditResults(results, opts.format) + "\n";
    }
    return { exitCode: computeExitCode(results, failOn), output };
  }

  const result = await runAudit(schemaResult.data!, configObj, auditConfig, {
    auditType: auditType as AuditType,
    format: opts.format,
    scope: opts.scope,
    dryRun: opts.dryRun,
  });

  let output: string;
  if (opts.dryRun) {
    output = result.prompt + "\n";
  } else {
    output = formatAuditResult(result, opts.format) + "\n";
  }
  return { exitCode: computeExitCode([result], failOn), output };
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
  .option("--fail-on <level>", "Minimum severity that causes exit 10 (info|warning|error|critical)", "critical")
  .option("-o, --output <file>", "Write result to a file instead of stdout")
  .option("--report-format <fmt>", "Alias for --format (for cli-contracts standard conformance)")
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
        failOn: string;
        output?: string;
        reportFormat?: string;
      },
    ) => {
      if (!AUDIT_TYPES.includes(type as (typeof AUDIT_TYPES)[number])) {
        process.stderr.write(
          `Unknown audit type: "${type}". Use one of: ${AUDIT_TYPES.join(", ")}\n`,
        );
        process.exit(1);
      }

      const format = (opts.reportFormat ?? opts.format) as OutputFormat;

      try {
        const config = await loadConfig(opts.config);
        if (!config) {
          process.stderr.write(
            "Error: agent-contracts.config.yaml not found. Use --config to specify path.\n",
          );
          process.exit(1);
        }

        if (isMultiTeamConfig(config)) {
          const teamEntries = getTeamEntries(config, opts.team);
          let maxExit = 0;
          const allOutput: string[] = [];
          for (const [teamId, teamConfig] of teamEntries) {
            process.stderr.write(`\n--- Team: ${teamId} ---\n`);
            const result = await runAuditForDsl(
              teamConfig.dsl,
              teamConfig.vars,
              config,
              type,
              { format, scope: opts.scope, dryRun: opts.dryRun, adapter: opts.adapter, model: opts.model },
              opts.failOn,
            );
            process.stdout.write(result.output);
            allOutput.push(result.output);
            if (result.exitCode > maxExit) maxExit = result.exitCode;
          }
          if (opts.output) writeFileSync(opts.output, allOutput.join(""), "utf8");
          process.exit(maxExit);
        }

        const result = await runAuditForDsl(
          config.dsl,
          config.vars,
          config,
          type,
          { format, scope: opts.scope, dryRun: opts.dryRun, adapter: opts.adapter, model: opts.model },
          opts.failOn,
        );
        process.stdout.write(result.output);
        if (opts.output) writeFileSync(opts.output, result.output, "utf8");
        process.exit(result.exitCode);
      } catch (err) {
        if (err instanceof ConfigLoadError) {
          process.stderr.write(`Config error: ${err.message}\n`);
          process.exit(1);
        }
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`Error: ${msg}\n`);
        if (msg.includes("not installed")) process.exit(11);
        if (msg.includes("adapter") || msg.includes("API")) process.exit(12);
        process.exit(1);
      }
    },
  );
