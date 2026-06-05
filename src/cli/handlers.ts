import { writeFileSync } from "node:fs";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { resolve as pathResolve } from "node:path";
import { access } from "node:fs/promises";
import { stringify, parse as parseYaml } from "yaml";
import type { CommandHandlers } from "../generated/cli-contract/program.js";
import { loadConfig, resolveDslPath, loadBindings, ConfigLoadError } from "../config/index.js";
import { resolve, substituteVars, resolveBound } from "../resolver/index.js";
import { expandDefaults } from "../resolver/expand-defaults.js";
import { validateSchema, checkReferences, validateHandoffSchemas } from "../validator/index.js";
import { lint, spectralLint } from "../linter/index.js";
import {
  renderFromConfig,
  checkDriftFromConfig,
  type RenderOptions,
} from "../renderer/index.js";
import { score } from "../scorer/index.js";
import type { ScoreResult } from "../scorer/index.js";
import { generateGuardrails } from "../guardrail-generator/index.js";
import { generateInterface } from "../interface-generator/index.js";
import {
  runAudit,
  runAllAudits,
  formatAuditResult,
  formatAuditResults,
  computeExitCode,
} from "../auditor/index.js";
import type { AuditType, AuditConfig, OutputFormat as AuditOutputFormat } from "../auditor/index.js";
import { formatDiagnostics, type OutputFormat } from "./format.js";
import { getTeamEntries, isMultiTeamConfig } from "./multi-team.js";
import type { ResolvedConfig, ResolvedTeamConfig } from "../config/types.js";
import { runGenerateInterfaceCli } from "./commands/generate-interface.js";
import { buildNavigationIndex } from "../navigation-index/index.js";
import type { ProjectNavigationIndex } from "../navigation-index/index.js";
import { enumerateProjectFiles } from "../artifact-coverage/enumerator.js";
import { buildCoverageReport, formatCoverageText } from "../artifact-coverage/reporter.js";
import type { ArtifactCoverageReport } from "../artifact-coverage/types.js";

const DIR_DEFAULT = "agent-contracts.yaml";

// ─── resolve ────────────────────────────────────────────────────

const handleResolve: CommandHandlers["resolve"] = async (dir, opts) => {
  try {
    const config = await loadConfig(opts.config);

    if (config !== null && isMultiTeamConfig(config)) {
      const teamEntries = getTeamEntries(config, opts.team);
      if (opts.format === "json") {
        const out: Record<string, unknown> = {};
        for (const [teamId, teamConfig] of teamEntries) {
          const result = await resolve(teamConfig.dsl);
          let data = teamConfig.vars
            ? substituteVars(result.data, teamConfig.vars)
            : result.data;
          if (opts.expandDefaults) data = expandDefaults(data);
          out[teamId] = data;
        }
        process.stdout.write(JSON.stringify(out, null, 2) + "\n");
      } else {
        for (const [teamId, teamConfig] of teamEntries) {
          process.stdout.write(`\n--- Team: ${teamId} ---\n`);
          const result = await resolve(teamConfig.dsl);
          let data = teamConfig.vars
            ? substituteVars(result.data, teamConfig.vars)
            : result.data;
          if (opts.expandDefaults) data = expandDefaults(data);
          process.stdout.write(stringify(data));
        }
      }
      return;
    }

    const dslPath = resolveDslPath(dir ?? DIR_DEFAULT, DIR_DEFAULT, config);
    const result = await resolve(dslPath);
    let data = config?.vars
      ? substituteVars(result.data, config.vars)
      : result.data;
    if (opts.expandDefaults) data = expandDefaults(data);

    if (opts.format === "json") {
      process.stdout.write(JSON.stringify(data, null, 2) + "\n");
    } else {
      process.stdout.write(stringify(data));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: ${msg}\n`);
    process.exit(1);
  }
};

// ─── validate ───────────────────────────────────────────────────

const handleValidate: CommandHandlers["validate"] = async (dir, opts) => {
  try {
    const config = await loadConfig(opts.config);

    if (config !== null && isMultiTeamConfig(config)) {
      const teamEntries = getTeamEntries(config, opts.team);
      let hasErrors = false;
      let allTeamsFullyClean = true;
      for (const [teamId, teamConfig] of teamEntries) {
        if (!opts.quiet) process.stdout.write(`\n--- Team: ${teamId} ---\n`);
        const resolved = await resolve(teamConfig.dsl);
        const data = teamConfig.vars
          ? substituteVars(resolved.data, teamConfig.vars)
          : resolved.data;
        const schemaResult = validateSchema(data);
        const schemaWarnings = schemaResult.diagnostics.filter(
          (d) => d.severity === "warning",
        );

        if (!schemaResult.success) {
          const output = formatDiagnostics(schemaResult.diagnostics, {
            format: (opts.format ?? "text") as OutputFormat,
            quiet: !!opts.quiet,
          });
          if (output) process.stderr.write(output + "\n");
          hasErrors = true;
          allTeamsFullyClean = false;
          continue;
        }

        const refDiags = checkReferences(schemaResult.data!);
        const handoffDiags = validateHandoffSchemas(schemaResult.data!);
        const allDiags = [...refDiags, ...handoffDiags, ...schemaWarnings];
        if (allDiags.length > 0) {
          allTeamsFullyClean = false;
          const output = formatDiagnostics(allDiags, {
            format: (opts.format ?? "text") as OutputFormat,
            quiet: !!opts.quiet,
          });
          if (output) process.stderr.write(output + "\n");
          const hasWarnings = allDiags.some(
            (d) => "severity" in d && d.severity === "warning",
          );
          if (refDiags.length > 0 || handoffDiags.length > 0 || (opts.strict && hasWarnings)) {
            hasErrors = true;
          }
        }
      }
      if (hasErrors) process.exit(1);
      if (!opts.quiet && allTeamsFullyClean) process.stdout.write("Validation passed.\n");
      return;
    }

    const dslPath = resolveDslPath(dir ?? DIR_DEFAULT, DIR_DEFAULT, config);
    const resolved = await resolve(dslPath);
    const data = config?.vars
      ? substituteVars(resolved.data, config.vars)
      : resolved.data;
    const schemaResult = validateSchema(data);
    const schemaWarnings = schemaResult.diagnostics.filter(
      (d) => d.severity === "warning",
    );

    if (!schemaResult.success) {
      const output = formatDiagnostics(schemaResult.diagnostics, {
        format: (opts.format ?? "text") as OutputFormat,
        quiet: !!opts.quiet,
      });
      if (output) process.stderr.write(output + "\n");
      process.exit(1);
    }

    const refDiags = checkReferences(schemaResult.data!);
    const handoffDiags = validateHandoffSchemas(schemaResult.data!);
    const allDiags = [...refDiags, ...handoffDiags, ...schemaWarnings];
    const hasWarnings = allDiags.some(
      (d) => "severity" in d && d.severity === "warning",
    );
    if (allDiags.length > 0) {
      const output = formatDiagnostics(allDiags, {
        format: (opts.format ?? "text") as OutputFormat,
        quiet: !!opts.quiet,
      });
      if (output) process.stderr.write(output + "\n");
      if (refDiags.length > 0 || handoffDiags.length > 0 || (opts.strict && hasWarnings)) {
        process.exit(1);
      }
    }

    if (!opts.quiet && allDiags.length === 0) process.stdout.write("Validation passed.\n");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: ${msg}\n`);
    process.exit(1);
  }
};

// ─── lint ───────────────────────────────────────────────────────

const handleLint: CommandHandlers["lint"] = async (dir, opts) => {
  try {
    const config = await loadConfig(opts.config);

    if (config !== null && isMultiTeamConfig(config)) {
      const teamEntries = getTeamEntries(config, opts.team);
      let hasErrors = false;
      let allClean = true;
      for (const [teamId, teamConfig] of teamEntries) {
        if (!opts.quiet) process.stdout.write(`\n--- Team: ${teamId} ---\n`);
        const resolved = await resolve(teamConfig.dsl);
        const data = teamConfig.vars
          ? substituteVars(resolved.data, teamConfig.vars)
          : resolved.data;
        const schemaResult = validateSchema(data);
        const schemaWarnings = schemaResult.diagnostics.filter(
          (d) => d.severity === "warning",
        );

        if (!schemaResult.success) {
          const output = formatDiagnostics(schemaResult.diagnostics, {
            format: (opts.format ?? "text") as OutputFormat,
            quiet: !!opts.quiet,
          });
          if (output) process.stderr.write(output + "\n");
          hasErrors = true;
          allClean = false;
          continue;
        }

        const tsDiagnostics = lint(schemaResult.data!);
        const spectralDiagnostics = await spectralLint(
          schemaResult.data! as unknown as Record<string, unknown>,
        );
        const diagnostics = [...tsDiagnostics, ...spectralDiagnostics, ...schemaWarnings];
        if (diagnostics.length > 0) {
          allClean = false;
          const output = formatDiagnostics(diagnostics, {
            format: (opts.format ?? "text") as OutputFormat,
            quiet: !!opts.quiet,
          });
          if (output) process.stderr.write(output + "\n");
          if (diagnostics.some((d) => d.severity === "error")) hasErrors = true;
          if (opts.strict && diagnostics.some((d) => d.severity === "warning")) hasErrors = true;
        }
      }
      if (hasErrors) process.exit(1);
      if (!opts.quiet && allClean) process.stdout.write("Lint passed.\n");
      return;
    }

    const dslPath = resolveDslPath(dir ?? DIR_DEFAULT, DIR_DEFAULT, config);
    const resolved = await resolve(dslPath);
    const data = config?.vars
      ? substituteVars(resolved.data, config.vars)
      : resolved.data;
    const schemaResult = validateSchema(data);
    const schemaWarnings = schemaResult.diagnostics.filter(
      (d) => d.severity === "warning",
    );

    if (!schemaResult.success) {
      const output = formatDiagnostics(schemaResult.diagnostics, {
        format: (opts.format ?? "text") as OutputFormat,
        quiet: !!opts.quiet,
      });
      if (output) process.stderr.write(output + "\n");
      process.exit(1);
    }

    const tsDiagnostics = lint(schemaResult.data!);
    const spectralDiagnostics = await spectralLint(
      schemaResult.data! as unknown as Record<string, unknown>,
    );
    const diagnostics = [...tsDiagnostics, ...spectralDiagnostics, ...schemaWarnings];
    if (diagnostics.length > 0) {
      const output = formatDiagnostics(diagnostics, {
        format: (opts.format ?? "text") as OutputFormat,
        quiet: !!opts.quiet,
      });
      if (output) process.stderr.write(output + "\n");
      if (diagnostics.some((d) => d.severity === "error")) process.exit(1);
      if (opts.strict && diagnostics.some((d) => d.severity === "warning")) process.exit(1);
    }

    if (!opts.quiet && diagnostics.length === 0) process.stdout.write("Lint passed.\n");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: ${msg}\n`);
    process.exit(1);
  }
};

// ─── render (deprecated) ────────────────────────────────────────

const handleRender: CommandHandlers["render"] = async (opts) => {
  process.stderr.write(
    "Warning: 'render' is deprecated. Use 'agent-contracts generate templates' instead.\n",
  );
  await handleGenerate("templates", {
    config: opts.config,
    team: opts.team,
    check: opts.check,
    format: "yaml",
    dryRun: false,
    quiet: opts.quiet,
  }, {});
};

// ─── check ──────────────────────────────────────────────────────

const handleCheck: CommandHandlers["check"] = async (opts) => {
  let hasErrors = false;

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
      for (const [teamId, teamConfig] of teamEntries) {
        if (!opts.quiet) process.stderr.write(`\n--- Team: ${teamId} ---\n`);
        const resolved = await resolve(teamConfig.dsl);
        const data = teamConfig.vars
          ? substituteVars(resolved.data, teamConfig.vars)
          : resolved.data;

        const schemaResult = validateSchema(data);
        const schemaWarnings = schemaResult.diagnostics.filter((d) => d.severity === "warning");
        if (!schemaResult.success) {
          const output = formatDiagnostics(schemaResult.diagnostics, {
            format: (opts.format ?? "text") as OutputFormat,
            quiet: !!opts.quiet,
          });
          if (output) process.stderr.write(output + "\n");
          hasErrors = true;
          continue;
        }

        const refDiags = checkReferences(schemaResult.data!);
        const handoffDiags = validateHandoffSchemas(schemaResult.data!);
        const allRefDiags = [...refDiags, ...handoffDiags, ...schemaWarnings];
        if (allRefDiags.length > 0) {
          const output = formatDiagnostics(allRefDiags, {
            format: (opts.format ?? "text") as OutputFormat,
            quiet: !!opts.quiet,
          });
          if (output) process.stderr.write(output + "\n");
          hasErrors = true;
        }

        const tsLintDiags = lint(schemaResult.data!);
        const spectralDiags = await spectralLint(
          schemaResult.data! as unknown as Record<string, unknown>,
        );
        const lintDiags = [...tsLintDiags, ...spectralDiags];
        if (lintDiags.length > 0) {
          const output = formatDiagnostics(lintDiags, {
            format: (opts.format ?? "text") as OutputFormat,
            quiet: !!opts.quiet,
          });
          if (output) process.stderr.write(output + "\n");
          if (lintDiags.some((d) => d.severity === "error")) hasErrors = true;
          if (opts.strict && lintDiags.some((d) => d.severity === "warning")) hasErrors = true;
        }

        let renderOptions: RenderOptions | undefined;
        if (teamConfig.bindings.length > 0) {
          const loadedBindings = await loadBindings(teamConfig.bindings);
          renderOptions = { loadedBindings, activeGuardrailPolicy: teamConfig.activeGuardrailPolicy };
        }
        const drift = await checkDriftFromConfig(schemaResult.data!, config.renders, renderOptions);
        if (drift.hasDrift) {
          process.stderr.write(`Drift detected for team ${teamId} in:\n`);
          for (const f of drift.diffs) process.stderr.write(`  ${f}\n`);
          hasErrors = true;
        }
      }

      if (!hasErrors) {
        for (const [teamId, teamConfig] of teamEntries) {
          const resolved = await resolve(teamConfig.dsl);
          const data = teamConfig.vars
            ? substituteVars(resolved.data, teamConfig.vars)
            : resolved.data;
          const schemaResult = validateSchema(data);
          if (!schemaResult.success || !schemaResult.data) continue;
          const dsl = schemaResult.data as Record<string, unknown>;
          const imports = dsl.imports as Record<string, { interface?: string }> | undefined;
          if (!imports) continue;
          for (const [importName, importDef] of Object.entries(imports)) {
            const interfacePathRel = importDef?.interface;
            if (typeof interfacePathRel !== "string") continue;
            const interfacePath = pathResolve(dirname(teamConfig.dsl), interfacePathRel);
            try {
              await access(interfacePath);
            } catch {
              process.stderr.write(
                `Cross-team error: Team "${teamId}" imports "${importName}" ` +
                  `but interface file not found: ${interfacePath}\n`,
              );
              hasErrors = true;
            }
          }
        }
      }

      if (hasErrors) process.exit(1);
      if (!opts.quiet) process.stdout.write("All checks passed.\n");
      return;
    }

    const resolved = await resolve(config.dsl);
    const data = config.vars
      ? substituteVars(resolved.data, config.vars)
      : resolved.data;
    const schemaResult = validateSchema(data);
    const schemaWarnings = schemaResult.diagnostics.filter((d) => d.severity === "warning");
    if (!schemaResult.success) {
      const output = formatDiagnostics(schemaResult.diagnostics, {
        format: (opts.format ?? "text") as OutputFormat,
        quiet: !!opts.quiet,
      });
      if (output) process.stderr.write(output + "\n");
      process.exit(1);
    }

    const refDiags = checkReferences(schemaResult.data!);
    const handoffDiags = validateHandoffSchemas(schemaResult.data!);
    const allRefDiags = [...refDiags, ...handoffDiags, ...schemaWarnings];
    if (allRefDiags.length > 0) {
      const output = formatDiagnostics(allRefDiags, {
        format: (opts.format ?? "text") as OutputFormat,
        quiet: !!opts.quiet,
      });
      if (output) process.stderr.write(output + "\n");
      hasErrors = true;
    }

    const tsLintDiags = lint(schemaResult.data!);
    const spectralDiags = await spectralLint(
      schemaResult.data! as unknown as Record<string, unknown>,
    );
    const lintDiags = [...tsLintDiags, ...spectralDiags];
    if (lintDiags.length > 0) {
      const output = formatDiagnostics(lintDiags, {
        format: (opts.format ?? "text") as OutputFormat,
        quiet: !!opts.quiet,
      });
      if (output) process.stderr.write(output + "\n");
      if (lintDiags.some((d) => d.severity === "error")) hasErrors = true;
      if (opts.strict && lintDiags.some((d) => d.severity === "warning")) hasErrors = true;
    }

    let renderOptions: RenderOptions | undefined;
    if (config.bindings.length > 0) {
      const loadedBindings = await loadBindings(config.bindings);
      renderOptions = { loadedBindings, activeGuardrailPolicy: config.activeGuardrailPolicy };
    }
    const drift = await checkDriftFromConfig(schemaResult.data!, config.renders, renderOptions);
    if (drift.hasDrift) {
      process.stderr.write("Drift detected in:\n");
      for (const f of drift.diffs) process.stderr.write(`  ${f}\n`);
      hasErrors = true;
    }

    if (schemaResult.data!.team_interface) {
      const interfacePath = join(config.configDir, "team-interface.yaml");
      if (existsSync(interfacePath)) {
        const result = generateInterface({ dsl: schemaResult.data!, dryRun: true, format: "yaml" });
        const existing = readFileSync(interfacePath, "utf8");
        const normalize = (raw: string): string => {
          try {
            const parsed = parseYaml(raw) as Record<string, unknown>;
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              const { generated_at: _t, ...rest } = parsed;
              return `${stringify(rest, { sortMapEntries: true })}\n`;
            }
          } catch { /* fall through */ }
          return raw.trim();
        };
        if (normalize(existing) !== normalize(result.content)) {
          process.stderr.write("Drift detected in team-interface.yaml\n");
          hasErrors = true;
        }
      }
    }

    if (hasErrors) process.exit(1);
    if (!opts.quiet) process.stdout.write("All checks passed.\n");
  } catch (err) {
    if (err instanceof ConfigLoadError) {
      process.stderr.write(`Config error: ${err.message}\n`);
      process.exit(1);
    }
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: ${msg}\n`);
    process.exit(1);
  }
};

// ─── score ──────────────────────────────────────────────────────

function formatScoreText(result: ScoreResult): string {
  const lines: string[] = [];
  lines.push(`DSL Completeness Score: ${result.overall}/100`);
  lines.push("");
  for (const d of result.dimensions) {
    const detail = d.total > 0 ? ` (${d.score}/${d.total} ${d.id.split("-")[0]})` : "";
    lines.push(`  ${d.label.padEnd(40)} ${String(d.percent).padStart(3)}%${detail}`);
  }
  const allRecs = result.dimensions.flatMap((d) => d.recommendations);
  if (allRecs.length > 0) {
    lines.push("");
    lines.push("Recommendations:");
    for (const rec of allRecs) lines.push(`  - ${rec}`);
  }
  return lines.join("\n");
}

const handleScore: CommandHandlers["score"] = async (dir, opts) => {
  try {
    const config = await loadConfig(opts.config);

    if (config !== null && isMultiTeamConfig(config)) {
      const teamEntries = getTeamEntries(config, opts.team);
      let thresholdNum: number | undefined;
      if (opts.threshold !== undefined) {
        thresholdNum = parseInt(String(opts.threshold), 10);
        if (isNaN(thresholdNum)) {
          process.stderr.write(`Error: --threshold must be a number, got "${opts.threshold}"\n`);
          process.exit(1);
        }
      }

      let hasErrors = false;
      for (const [teamId, teamConfig] of teamEntries) {
        process.stdout.write(`\n--- Team: ${teamId} ---\n`);
        const resolved = await resolve(teamConfig.dsl);
        const data = teamConfig.vars
          ? substituteVars(resolved.data, teamConfig.vars)
          : resolved.data;
        const schemaResult = validateSchema(data);
        if (!schemaResult.success) {
          const issues = schemaResult.diagnostics.map((d) => `  ${d.path}: ${d.message}`).join("\n");
          process.stderr.write(`Schema validation failed:\n${issues}\n`);
          hasErrors = true;
          continue;
        }
        const result = score(schemaResult.data!);
        if (opts.format === "json") {
          process.stdout.write(JSON.stringify(result, null, 2) + "\n");
        } else {
          process.stdout.write(formatScoreText(result) + "\n");
        }
        if (thresholdNum !== undefined && result.overall < thresholdNum) {
          process.stderr.write(`Score ${result.overall} is below threshold ${thresholdNum}\n`);
          hasErrors = true;
        }
      }
      if (hasErrors) process.exit(1);
      return;
    }

    const dslPath = resolveDslPath(dir ?? DIR_DEFAULT, DIR_DEFAULT, config);
    const resolved = await resolve(dslPath);
    const data = config?.vars
      ? substituteVars(resolved.data, config.vars)
      : resolved.data;
    const schemaResult = validateSchema(data);
    if (!schemaResult.success) {
      const issues = schemaResult.diagnostics.map((d) => `  ${d.path}: ${d.message}`).join("\n");
      process.stderr.write(`Schema validation failed:\n${issues}\n`);
      process.exit(1);
    }
    const result = score(schemaResult.data!);
    if (opts.format === "json") {
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    } else {
      process.stdout.write(formatScoreText(result) + "\n");
    }
    if (opts.threshold !== undefined) {
      const threshold = parseInt(String(opts.threshold), 10);
      if (isNaN(threshold)) {
        process.stderr.write(`Error: --threshold must be a number, got "${opts.threshold}"\n`);
        process.exit(1);
      }
      if (result.overall < threshold) {
        process.stderr.write(`Score ${result.overall} is below threshold ${threshold}\n`);
        process.exit(1);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: ${msg}\n`);
    process.exit(1);
  }
};

// ─── audit ──────────────────────────────────────────────────────

const AUDIT_TYPES = ["render", "dsl", "prompt", "extensions", "all"] as const;

function parseAuditConfig(configObj: Record<string, unknown> | undefined): AuditConfig {
  if (!configObj) return {};
  const audit = configObj as Record<string, unknown>;
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
  auditOpts: { format: AuditOutputFormat; scope?: string; showPrompt: boolean; adapter?: string; model?: string; logFile?: string },
  failOn?: string,
): Promise<{ exitCode: number; output: string }> {
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
  if (auditOpts.adapter) auditConfig.adapter = auditOpts.adapter;
  if (auditOpts.model) auditConfig.model = auditOpts.model;

  if (auditType === "all") {
    const results = await runAllAudits(schemaResult.data!, configObj, auditConfig, {
      format: auditOpts.format,
      scope: auditOpts.scope,
      showPrompt: auditOpts.showPrompt,
      logFile: auditOpts.logFile,
    });
    let output: string;
    if (auditOpts.showPrompt) {
      output = results.map((r) => `\n--- Audit prompt: ${r.auditType} ---\n${r.prompt}\n`).join("");
    } else {
      output = formatAuditResults(results, auditOpts.format) + "\n";
    }
    return { exitCode: computeExitCode(results, failOn), output };
  }

  const result = await runAudit(schemaResult.data!, configObj, auditConfig, {
    auditType: auditType as AuditType,
    format: auditOpts.format,
    scope: auditOpts.scope,
    showPrompt: auditOpts.showPrompt,
    logFile: auditOpts.logFile,
  });
  let output: string;
  if (auditOpts.showPrompt) {
    output = result.prompt + "\n";
  } else {
    output = formatAuditResult(result, auditOpts.format) + "\n";
  }
  return { exitCode: computeExitCode([result], failOn), output };
}

const handleAudit: CommandHandlers["audit"] = async (type, opts) => {
  const auditType = type ?? "all";
  if (!AUDIT_TYPES.includes(auditType as (typeof AUDIT_TYPES)[number])) {
    process.stderr.write(
      `Unknown audit type: "${auditType}". Use one of: ${AUDIT_TYPES.join(", ")}\n`,
    );
    process.exit(1);
  }

  const format = (opts.reportFormat ?? opts.format ?? "text") as AuditOutputFormat;

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
          auditType,
          { format, scope: opts.scope, showPrompt: !!opts.showPrompt, adapter: opts.adapter, model: opts.model, logFile: opts.logFile },
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
      auditType,
      { format, scope: opts.scope, showPrompt: !!opts.showPrompt, adapter: opts.adapter, model: opts.model, logFile: opts.logFile },
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
};

// ─── generate ───────────────────────────────────────────────────

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

const handleGenerate: CommandHandlers["generate"] = async (type, opts) => {
  if (type !== undefined && !(VALID_TYPES as readonly string[]).includes(type)) {
    process.stderr.write(`Unknown generate type: ${type}\n`);
    process.exit(1);
  }

  const fmt = opts.format ?? "yaml";
  if (fmt !== "yaml" && fmt !== "json") {
    process.stderr.write(`Invalid --format: expected yaml or json, got ${fmt}\n`);
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

    const processTeam = async (
      teamConfig: ResolvedTeamConfig,
      teamLabel: string | undefined,
    ): Promise<boolean> => {
      let exitWithError = false;
      const resolved = await resolve(teamConfig.dsl);
      const data = teamConfig.vars
        ? substituteVars(resolved.data, teamConfig.vars)
        : resolved.data;
      const schemaResult = validateSchema(data);
      if (!schemaResult.success) {
        process.stderr.write(
          `Schema validation failed${teamLabel ? ` for team ${teamLabel}` : ""}. Run 'agent-contracts validate' for details.\n`,
        );
        return true;
      }

      if (targets.templates) {
        let renderOptions: RenderOptions | undefined;
        if (teamConfig.bindings.length > 0) {
          const loadedBindings = await loadBindings(teamConfig.bindings);
          renderOptions = { loadedBindings, activeGuardrailPolicy: teamConfig.activeGuardrailPolicy };
        }
        if (opts.check) {
          const drift = await checkDriftFromConfig(schemaResult.data!, config.renders, renderOptions);
          if (drift.hasDrift) {
            process.stderr.write(`Drift detected${teamLabel ? ` for team ${teamLabel}` : ""} in the following files:\n`);
            for (const f of drift.diffs) process.stderr.write(`  ${f}\n`);
            exitWithError = true;
          } else if (!opts.quiet) {
            process.stdout.write("No drift detected.\n");
          }
        } else {
          const files = await renderFromConfig(schemaResult.data!, config.renders, renderOptions);
          if (!opts.quiet) {
            process.stdout.write(`Rendered ${files.length} file(s):\n`);
            for (const f of files) process.stdout.write(`  ${f}\n`);
          }
        }
      }

      if (targets.interface) {
        if (schemaResult.data!.team_interface) {
          runGenerateInterfaceCli({
            dsl: schemaResult.data!,
            output: teamConfig.interfaceOutput ?? opts.output,
            dryRun: !!opts.dryRun,
            format: fmt as "yaml" | "json",
            quiet: !!opts.quiet,
          });
        } else if (normalizedType === "interface") {
          process.stderr.write("Error: DSL has no team_interface section.\n");
          exitWithError = true;
        }
      }

      if (targets.guardrails) {
        const loadedBindings = await loadBindings(teamConfig.bindings);
        const cfgForTeam = teamLabel
          ? resolvedConfigForTeam(config, teamConfig)
          : config;
        const result = await generateGuardrails({
          dsl: schemaResult.data!,
          config: cfgForTeam,
          loadedBindings,
          filterBindings: opts.binding ? [opts.binding] : undefined,
          dryRun: !!opts.dryRun,
        });

        const errors = result.diagnostics.filter((d) => d.severity === "error");
        const warnings = result.diagnostics.filter((d) => d.severity === "warning");
        const infos = result.diagnostics.filter((d) => d.severity === "info");

        if (errors.length > 0) {
          process.stderr.write(`Errors${teamLabel ? ` (team ${teamLabel})` : ""}:\n`);
          for (const d of errors) process.stderr.write(`  error [${d.path}] ${d.message}\n`);
          exitWithError = true;
        }
        if (warnings.length > 0 && !opts.quiet) {
          process.stderr.write(`Warnings${teamLabel ? ` (team ${teamLabel})` : ""}:\n`);
          for (const d of warnings) process.stderr.write(`  warning [${d.path}] ${d.message}\n`);
        }
        if (infos.length > 0 && !opts.quiet) {
          for (const d of infos) process.stderr.write(`  info [${d.path}] ${d.message}\n`);
        }
        if (!opts.quiet) {
          const action = opts.dryRun ? "Would generate" : "Generated";
          process.stdout.write(`${action} ${result.outputFiles.length} file(s):\n`);
          for (const f of result.outputFiles) process.stdout.write(`  ${f}\n`);
        }
      }

      return exitWithError;
    };

    if (isMultiTeamConfig(config)) {
      const teamEntries = getTeamEntries(config, opts.team);
      let exitWithError = false;
      for (const [teamId, teamConfig] of teamEntries) {
        if (!opts.quiet) process.stdout.write(`\n--- Team: ${teamId} ---\n`);
        if (await processTeam(teamConfig, teamId)) exitWithError = true;
      }
      if (exitWithError) process.exit(1);
      return;
    }

    const singleTeamConfig: ResolvedTeamConfig = {
      dsl: config.dsl,
      vars: config.vars,
      bindings: config.bindings,
      activeGuardrailPolicy: config.activeGuardrailPolicy,
      paths: config.paths,
    };
    if (await processTeam(singleTeamConfig, undefined)) process.exit(1);
  } catch (err) {
    if (err instanceof ConfigLoadError) {
      process.stderr.write(`Config error: ${err.message}\n`);
      process.exit(1);
    }
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: ${msg}\n`);
    process.exit(1);
  }
};

// ─── navigation-index ───────────────────────────────────────────

function filterIndexByArtifact(
  index: ProjectNavigationIndex,
  artifactId: string,
): ProjectNavigationIndex {
  const node = index.artifacts[artifactId];
  if (!node) {
    throw new Error(`Artifact not found: ${artifactId}`);
  }
  return {
    ...index,
    artifacts: { [artifactId]: node },
  };
}

function writeNavigationIndex(index: ProjectNavigationIndex, format: string): void {
  if (format === "json") {
    process.stdout.write(JSON.stringify(index, null, 2) + "\n");
  } else {
    process.stdout.write(stringify(index));
  }
}

async function buildNavigationIndexForDsl(
  dslPath: string,
  vars: Record<string, string> | undefined,
  artifactFilter: string | undefined,
  artifactBinding?: { source: string; mappings?: Record<string, string> },
  paths?: Record<string, string>,
): Promise<ProjectNavigationIndex> {
  const resolved = await resolve(dslPath);
  let data = vars ? substituteVars(resolved.data, vars) : resolved.data;
  if (artifactBinding) {
    const boundResult = await resolveBound(data, { artifactBinding, paths });
    data = boundResult.data;
  }
  const schemaResult = validateSchema(data);
  if (!schemaResult.success) {
    const issues = schemaResult.diagnostics.map((d) => `  ${d.path}: ${d.message}`).join("\n");
    process.stderr.write(`Schema validation failed:\n${issues}\n`);
    throw new Error("schema validation failed");
  }
  let index = buildNavigationIndex(schemaResult.data!);
  if (artifactFilter) {
    index = filterIndexByArtifact(index, artifactFilter);
  }
  return index;
}

const handleNavigationIndex: CommandHandlers["navigationIndex"] = async (dir, opts) => {
  const fmt = opts.format ?? "json";
  if (fmt !== "json" && fmt !== "yaml") {
    process.stderr.write(`Invalid --format: expected json or yaml, got ${fmt}\n`);
    process.exit(1);
  }

  try {
    const config = await loadConfig(opts.config);

    if (config !== null && isMultiTeamConfig(config)) {
      const teamEntries = getTeamEntries(config, opts.team);
      let hasErrors = false;

      if (fmt === "json") {
        const out: Record<string, ProjectNavigationIndex> = {};
        for (const [teamId, teamConfig] of teamEntries) {
          try {
            out[teamId] = await buildNavigationIndexForDsl(
              teamConfig.dsl,
              teamConfig.vars,
              opts.artifact,
              teamConfig.artifactBinding,
              teamConfig.paths,
            );
          } catch (err) {
            if (err instanceof Error && err.message === "schema validation failed") {
              hasErrors = true;
              continue;
            }
            throw err;
          }
        }
        if (hasErrors) process.exit(1);
        process.stdout.write(JSON.stringify(out, null, 2) + "\n");
      } else {
        for (const [teamId, teamConfig] of teamEntries) {
          if (!opts.quiet) process.stdout.write(`\n--- Team: ${teamId} ---\n`);
          try {
            const index = await buildNavigationIndexForDsl(
              teamConfig.dsl,
              teamConfig.vars,
              opts.artifact,
              teamConfig.artifactBinding,
              teamConfig.paths,
            );
            process.stdout.write(stringify(index));
          } catch (err) {
            if (err instanceof Error && err.message === "schema validation failed") {
              hasErrors = true;
              continue;
            }
            throw err;
          }
        }
        if (hasErrors) process.exit(1);
      }
      return;
    }

    const dslPath = resolveDslPath(dir ?? DIR_DEFAULT, DIR_DEFAULT, config);
    const index = await buildNavigationIndexForDsl(
      dslPath, config?.vars, opts.artifact, config?.artifactBinding, config?.paths,
    );
    writeNavigationIndex(index, fmt);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: ${msg}\n`);
    process.exit(1);
  }
};

// ─── artifact-coverage ───────────────────────────────────────────

const handleArtifactCoverage: CommandHandlers["artifactCoverage"] = async (dir, opts) => {
  const fmt = opts.format ?? "text";
  if (fmt !== "text" && fmt !== "json") {
    process.stderr.write(`Invalid --format: expected text or json, got ${fmt}\n`);
    process.exit(1);
  }

  try {
    const config = await loadConfig(opts.config);
    const excludePatterns = config?.artifactCoverage?.exclude_patterns ?? [];

    if (config !== null && isMultiTeamConfig(config)) {
      const teamEntries = getTeamEntries(config, opts.team);
      const results: Record<string, ArtifactCoverageReport> = {};

      for (const [teamId, teamConfig] of teamEntries) {
        const index = await buildNavigationIndexForDsl(
          teamConfig.dsl, teamConfig.vars, undefined,
          teamConfig.artifactBinding, teamConfig.paths,
        );
        const artifactFiles = extractArtifactFiles(index);
        const projectRoot = dirname(teamConfig.dsl);
        const files = enumerateProjectFiles(projectRoot, excludePatterns);
        results[teamId] = buildCoverageReport(files, artifactFiles);
      }

      if (fmt === "json") {
        process.stdout.write(JSON.stringify(results, null, 2) + "\n");
      } else {
        for (const [teamId, report] of Object.entries(results)) {
          process.stdout.write(`\n--- Team: ${teamId} ---\n`);
          process.stdout.write(formatCoverageText(report));
        }
      }

      if (opts.minCoverage !== undefined) {
        const threshold = parseFloat(opts.minCoverage);
        const allAbove = Object.values(results).every(
          (r) => r.summary.coverage_percent >= threshold,
        );
        if (!allAbove) {
          process.stderr.write(`Coverage below threshold (${threshold}%)\n`);
          process.exit(1);
        }
      }
      return;
    }

    const dslPath = resolveDslPath(dir ?? DIR_DEFAULT, DIR_DEFAULT, config);
    const index = await buildNavigationIndexForDsl(
      dslPath, config?.vars, undefined, config?.artifactBinding, config?.paths,
    );
    const artifactFiles = extractArtifactFiles(index);
    const projectRoot = config?.configDir ?? dirname(dslPath);
    const files = enumerateProjectFiles(projectRoot, excludePatterns);
    const report = buildCoverageReport(files, artifactFiles);

    if (fmt === "json") {
      process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    } else {
      process.stdout.write(formatCoverageText(report));
    }

    if (opts.minCoverage !== undefined) {
      const threshold = parseFloat(opts.minCoverage);
      if (report.summary.coverage_percent < threshold) {
        process.stderr.write(
          `Coverage ${report.summary.coverage_percent}% is below threshold (${threshold}%)\n`,
        );
        process.exit(1);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: ${msg}\n`);
    process.exit(1);
  }
};

function extractArtifactFiles(
  index: ProjectNavigationIndex,
): Record<string, { path_patterns: string[]; exclude_patterns: string[] }> {
  const result: Record<string, { path_patterns: string[]; exclude_patterns: string[] }> = {};
  for (const [id, node] of Object.entries(index.artifacts)) {
    if (node.files.path_patterns.length > 0) {
      result[id] = {
        path_patterns: node.files.path_patterns,
        exclude_patterns: node.files.exclude_patterns,
      };
    }
  }
  return result;
}

// ─── Export ─────────────────────────────────────────────────────

export const handlers: CommandHandlers = {
  resolve: handleResolve,
  validate: handleValidate,
  lint: handleLint,
  render: handleRender,
  check: handleCheck,
  score: handleScore,
  audit: handleAudit,
  generate: handleGenerate,
  navigationIndex: handleNavigationIndex,
  artifactCoverage: handleArtifactCoverage,
};
