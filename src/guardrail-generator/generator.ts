import { readFile, writeFile, mkdir, chmod, unlink, copyFile } from "node:fs/promises";
import { resolve, dirname, extname, basename } from "node:path";
import Handlebars from "handlebars";
import YAML from "yaml";
import type { Dsl } from "../schema/index.js";
import type { ResolvedConfig } from "../config/types.js";
import type { LoadedBinding } from "../config/binding-loader.js";
import type { BindingOutput, SoftwareBinding } from "../schema/index.js";
import type { ContextType } from "../schema/context-type.js";
import type {
  BindingGenerationContext,
  GenerateResult,
  GenerateDiagnostic,
} from "./types.js";
import { resolveChecks } from "./resolve-checks.js";
import { resolveBindingTargetPath } from "./resolve-paths.js";
import {
  buildEntityContext,
  buildSystemContext,
  getDslSection,
  filterIds,
  expandOutputPath,
  hasUnresolvedPathVars,
} from "../renderer/index.js";
import { buildNavigationIndex } from "../navigation-index/index.js";

// Register the `json` template helper
Handlebars.registerHelper("json", (value: unknown) => {
  return new Handlebars.SafeString(JSON.stringify(value, null, 2));
});

// Register the `expand` template helper for reporting command placeholder expansion
Handlebars.registerHelper(
  "expand",
  (pattern: string, options: Handlebars.HelperOptions) => {
    if (typeof pattern !== "string") return "";
    const hash = options.hash as Record<string, string>;
    let result = pattern;
    for (const [key, val] of Object.entries(hash)) {
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), String(val));
    }
    return new Handlebars.SafeString(result);
  },
);

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

function deepMergeArrays(
  existing: unknown[],
  incoming: unknown[],
  mergeKey?: string,
): unknown[] {
  if (!mergeKey) return [...existing, ...incoming];
  const merged = [...existing];
  for (const item of incoming) {
    if (isPlainObject(item) && mergeKey in item) {
      const idx = merged.findIndex(
        (e) => isPlainObject(e) && e[mergeKey] === item[mergeKey],
      );
      if (idx >= 0) {
        merged[idx] = item;
      } else {
        merged.push(item);
      }
    } else {
      merged.push(item);
    }
  }
  return merged;
}

function deepMerge(
  existing: unknown,
  incoming: unknown,
  arrayMergeKey?: string,
): unknown {
  if (Array.isArray(existing) && Array.isArray(incoming)) {
    return deepMergeArrays(existing, incoming, arrayMergeKey);
  }
  if (isPlainObject(existing) && isPlainObject(incoming)) {
    const result: Record<string, unknown> = { ...existing };
    for (const [key, val] of Object.entries(incoming)) {
      result[key] = key in result
        ? deepMerge(result[key], val, arrayMergeKey)
        : val;
    }
    return result;
  }
  return incoming;
}

function parseContent(raw: string, format: string): unknown {
  if (format === "json") return JSON.parse(raw);
  if (format === "yaml") return YAML.parse(raw);
  throw new Error(`Unsupported format for patch parsing: ${format}`);
}

function serializeContent(data: unknown, format: string): string {
  if (format === "json") return JSON.stringify(data, null, 2) + "\n";
  if (format === "yaml") return YAML.stringify(data);
  throw new Error(`Unsupported format for patch serialization: ${format}`);
}

/**
 * Infer the output format from explicit setting or from template/target file extension.
 * Defaults to "json" for patch mode when nothing can be inferred.
 */
function inferOutputFormat(
  outputDef: BindingOutput,
  targetPath: string,
): "json" | "yaml" | "bash" | "text" {
  if (outputDef.format) return outputDef.format as "json" | "yaml" | "bash" | "text";

  // Strip .hbs suffix from template name before checking extension
  const templateRef = (outputDef.template ?? "").replace(/\.hbs$/, "");
  const refs = [templateRef, targetPath].filter(Boolean);

  for (const ref of refs) {
    const ext = extname(basename(ref)).toLowerCase();
    if (ext === ".json") return "json";
    if (ext === ".yaml" || ext === ".yml") return "yaml";
    if (ext === ".sh" || ext === ".bash") return "bash";
    if (ext === ".txt") return "text";
  }

  return "json"; // safe default for patch mode
}

/**
 * Apply section_append: find the first `# BEGIN <id>` / `# END <id>` block in
 * `incoming`, then replace the matching block in `existing` (idempotent) or
 * append if the block is not yet present.  Falls back to simple append when
 * `incoming` contains no section markers.
 */
function applySectionBlock(existing: string, incoming: string): string {
  const beginRe = /^#\s*BEGIN\s+(\S+)/m;
  const beginMatch = beginRe.exec(incoming);

  if (!beginMatch) {
    // No markers — simple append
    const sep = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
    return existing + sep + incoming;
  }

  const sectionId = beginMatch[1]!;
  const escaped = sectionId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Match the entire block in the existing file (BEGIN line through END line)
  const blockRe = new RegExp(
    `^#\\s*BEGIN\\s+${escaped}[^\\n]*(?:\\r?\\n)[\\s\\S]*?^#\\s*END\\s+${escaped}[^\\n]*$`,
    "m",
  );

  if (blockRe.test(existing)) {
    // Replace existing block — use a function to avoid `$` special chars in replacement
    const replacement = incoming.endsWith("\n") ? incoming.slice(0, -1) : incoming;
    return existing.replace(blockRe, () => replacement);
  }

  // Block not found — append
  const sep = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  return existing + sep + incoming;
}

async function applyPatch(
  targetPath: string,
  patchContent: string,
  outputDef: BindingOutput,
): Promise<string> {
  const format = inferOutputFormat(outputDef, targetPath);
  const strategy = outputDef.patch_strategy ?? "deep_merge";

  // ── text / bash formats ──────────────────────────────────────────────────
  if (format === "text" || format === "bash") {
    let existing = "";
    try {
      existing = await readFile(targetPath, "utf8");
    } catch { /* first write */ }

    if (strategy === "section_append") {
      return applySectionBlock(existing, patchContent);
    }

    return existing + patchContent;
  }

  // ── JSON / YAML formats ──────────────────────────────────────────────────
  const patchData = parseContent(patchContent, format);

  let existingData: unknown;
  try {
    const existingRaw = await readFile(targetPath, "utf8");
    existingData = parseContent(existingRaw, format);
  } catch {
    return serializeContent(patchData, format);
  }

  // "array_append" — also handle legacy "append" alias for backward compat
  if (
    (strategy === "array_append" || strategy === ("append" as string)) &&
    Array.isArray(existingData)
  ) {
    const merged = deepMergeArrays(
      existingData,
      Array.isArray(patchData) ? patchData : [patchData],
      outputDef.array_merge_key,
    );
    return serializeContent(merged, format);
  }

  const merged = deepMerge(existingData, patchData, outputDef.array_merge_key);
  return serializeContent(merged, format);
}

// ── Builtin template generators ──────────────────────────────────────────────

/**
 * Generate the content for a `builtin:event-mapping` output.
 * Serialises the binding's `event_mapping` as pretty-printed JSON.
 */
function generateEventMappingContent(
  ctx: BindingGenerationContext,
): string {
  const em = ctx.binding.event_mapping ?? {};
  return JSON.stringify(em, null, 2) + "\n";
}

/**
 * Generate `task-patterns.json`: maps each task ID to its agent, workflow,
 * and a structured tag map derived entirely from DSL declarations.
 */
function generateTaskPatternsContent(
  ctx: BindingGenerationContext,
): string {
  const result: Record<string, unknown> = {};
  for (const [taskId, task] of Object.entries(ctx.tasks)) {
    const agent = ctx.agents[task.target_agent];
    result[taskId] = {
      agent: task.target_agent,
      workflow: task.workflow,
      tags: {
        "task.id": taskId,
        "task.workflow": task.workflow,
        "agent.id": task.target_agent,
        ...(agent ? { "agent.role": agent.role_name } : {}),
      },
    };
  }
  return JSON.stringify(result, null, 2) + "\n";
}

/**
 * Generate `artifact-lookup.json`: maps each artifact ID to its declared
 * path globs.  Only artifacts that have `path_patterns` are included so the
 * output remains strictly derived from the DSL — no project-specific patterns
 * are ever hard-coded here.
 */
function generateArtifactLookupContent(
  ctx: BindingGenerationContext,
): string {
  const result: Record<string, unknown> = {};
  for (const [artifactId, artifact] of Object.entries(ctx.artifacts)) {
    if (artifact.path_patterns && artifact.path_patterns.length > 0) {
      result[artifactId] = {
        path_patterns: artifact.path_patterns,
        ...(artifact.exclude_patterns && artifact.exclude_patterns.length > 0
          ? { exclude_patterns: artifact.exclude_patterns }
          : {}),
      };
    }
  }
  return JSON.stringify(result, null, 2) + "\n";
}

/**
 * Generate a recorder shell script that emits observability events for each
 * hook event declared in `event_mapping`.
 */
function generateRecorderContent(
  ctx: BindingGenerationContext,
): string {
  const eventMapping = ctx.binding.event_mapping ?? {};
  const eventNames = Object.keys(eventMapping);

  const emitCmd = ctx.reporting?.commands?.["emit"] ?? 'echo "event: $event_name"';

  const lines: string[] = [
    "#!/bin/sh",
    "# Auto-generated by agent-contracts — DO NOT EDIT",
    "# Observability recorder for hook events",
    "",
    "record_event() {",
    "  local event_name=\"$1\"",
    "  local payload=\"${2:-}\"",
    `  ${emitCmd}`,
    "}",
    "",
  ];

  if (eventNames.length > 0) {
    lines.push("# Registered hook events:");
    for (const name of eventNames) {
      lines.push(`#   ${name}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Generate a git hook shell script that fires for promotion events declared
 * in `event_mapping`.  Events whose names start with `git:` or contain
 * `promotion`, `commit`, or `push` are treated as promotion events.
 */
function generateGitHookContent(
  ctx: BindingGenerationContext,
): string {
  const eventMapping = ctx.binding.event_mapping ?? {};

  const promotionEvents = Object.entries(eventMapping).filter(
    ([name]) =>
      name.startsWith("git:") ||
      name.includes("promotion") ||
      name.includes("commit") ||
      name.includes("push"),
  );

  const emitCmd = ctx.reporting?.commands?.["emit"] ?? 'echo "event: $event_name"';

  const lines: string[] = [
    "#!/bin/sh",
    "# Auto-generated by agent-contracts — DO NOT EDIT",
    "# Git hook for promotion events",
    "",
  ];

  if (promotionEvents.length > 0) {
    lines.push("# Promotion events handled by this hook:");
    for (const [name] of promotionEvents) {
      lines.push(`#   ${name}`);
      lines.push(`${emitCmd.replace("$event_name", JSON.stringify(name))}`);
    }
    lines.push("");
  }

  lines.push("exit 0", "");
  return lines.join("\n");
}

/**
 * Dispatch to a specific builtin content generator.
 * Returns `null` for unknown builtin names so the caller can push an
 * "info" diagnostic and skip the output.
 */
function generateBuiltinContent(
  builtinName: string,
  ctx: BindingGenerationContext,
  _outputId: string,
): string | null {
  switch (builtinName) {
    case "event-mapping":
      return generateEventMappingContent(ctx);
    case "task-patterns":
      return generateTaskPatternsContent(ctx);
    case "artifact-lookup":
      return generateArtifactLookupContent(ctx);
    case "recorder":
      return generateRecorderContent(ctx);
    case "git-hook":
      return generateGitHookContent(ctx);
    default:
      return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export interface GenerateGuardrailsOptions {
  dsl: Dsl;
  config: ResolvedConfig;
  loadedBindings: LoadedBinding[];
  filterBindings?: string[];
  dryRun?: boolean;
}

export async function generateGuardrails(
  options: GenerateGuardrailsOptions,
): Promise<GenerateResult> {
  const { dsl, config, loadedBindings, filterBindings, dryRun } = options;
  const outputFiles: string[] = [];
  const diagnostics: GenerateDiagnostic[] = [];

  // Select active policy
  const policyName = config.activeGuardrailPolicy;
  if (!policyName) {
    diagnostics.push({
      path: "config.active_guardrail_policy",
      message:
        "No active_guardrail_policy specified in config — no guardrails will be generated",
      severity: "warning",
    });
    return { outputFiles, diagnostics };
  }

  const policy = dsl.guardrail_policies[policyName];
  if (!policy) {
    diagnostics.push({
      path: "config.active_guardrail_policy",
      message: `Active guardrail policy "${policyName}" not found in DSL guardrail_policies`,
      severity: "error",
    });
    return { outputFiles, diagnostics };
  }

  // Build all_bindings map
  const allBindings: Record<string, LoadedBinding["binding"]> = {};
  for (const lb of loadedBindings) {
    allBindings[lb.binding.software] = lb.binding;
  }

  // Find reporting binding (one with `reporting` section)
  let reporting: BindingGenerationContext["reporting"] = null;
  for (const lb of loadedBindings) {
    if (lb.binding.reporting) {
      reporting = {
        commands: lb.binding.reporting.commands,
        fail_open: lb.binding.reporting.fail_open,
        timeout_ms: lb.binding.reporting.timeout_ms,
      };
      break;
    }
  }

  const paths = config.paths ?? {};
  const vars = config.vars ?? {};

  // Process each binding
  for (const lb of loadedBindings) {
    const binding = lb.binding as SoftwareBinding;

    if (filterBindings && !filterBindings.includes(binding.software)) {
      continue;
    }

    if (!binding.outputs && !binding.renders) continue;

    // Resolve checks for this binding
    const checkResult = resolveChecks(dsl, binding, policy);
    diagnostics.push(...checkResult.diagnostics);

    // Build generation context
    const ctx: BindingGenerationContext = {
      system: { id: dsl.system.id, name: dsl.system.name },
      guardrails: dsl.guardrails,
      policy,
      binding,
      all_bindings: allBindings,
      vars,
      paths,
      reporting,
      resolved_checks: checkResult.resolved,
      tasks: dsl.tasks,
      artifacts: dsl.artifacts,
      agents: dsl.agents,
      handoff_types: dsl.handoff_types,
      workflow: dsl.workflow,
    };

    // Process each output
    for (const [outputId, outputDef] of Object.entries(binding.outputs ?? {})) {
      // Resolve target path
      const pathResult = resolveBindingTargetPath(
        outputDef.target,
        paths,
        binding.software,
      );
      diagnostics.push(...pathResult.diagnostics);

      if (pathResult.diagnostics.some((d) => d.severity === "error")) {
        continue;
      }

      const targetPath = resolve(config.configDir, pathResult.resolved);

      // ── source: file copy without template processing ──────────────────
      if (outputDef.source) {
        const sourcePath = resolve(config.configDir, outputDef.source);
        if (!dryRun) {
          try {
            await mkdir(dirname(targetPath), { recursive: true });
            await copyFile(sourcePath, targetPath);
            if (outputDef.executable) {
              await chmod(targetPath, 0o755);
            }
          } catch (err) {
            const code = (err as NodeJS.ErrnoException).code;
            if (code === "ENOENT") {
              diagnostics.push({
                path: `binding.${binding.software}.outputs.${outputId}`,
                message: `Source file not found: ${sourcePath}`,
                severity: "error",
              });
              continue;
            }
            throw err;
          }
        }
        outputFiles.push(targetPath);
        continue;
      }

      // ── template / inline_template rendering ──────────────────────────
      let templateContent: string;
      if (outputDef.inline_template) {
        templateContent = outputDef.inline_template;
      } else if (outputDef.template) {
        // ── builtin template dispatch ──────────────────────────────────
        if (outputDef.template.startsWith("builtin:")) {
          const builtinName = outputDef.template.slice("builtin:".length);
          const builtinContent = generateBuiltinContent(builtinName, ctx, outputId);

          if (builtinContent === null) {
            diagnostics.push({
              path: `binding.${binding.software}.outputs.${outputId}`,
              message: `Builtin template "${outputDef.template}" is not yet implemented — skipping`,
              severity: "info",
            });
            continue;
          }

          if (!dryRun) {
            await mkdir(dirname(targetPath), { recursive: true });
            await writeFile(targetPath, builtinContent, "utf8");
            if (outputDef.executable) {
              await chmod(targetPath, 0o755);
            }
          }
          outputFiles.push(targetPath);
          continue;
        }

        const templatePath = resolve(config.configDir, outputDef.template);
        try {
          templateContent = await readFile(templatePath, "utf8");
        } catch {
          diagnostics.push({
            path: `binding.${binding.software}.outputs.${outputId}`,
            message: `Template file not found: ${templatePath}`,
            severity: "error",
          });
          continue;
        }
      } else {
        diagnostics.push({
          path: `binding.${binding.software}.outputs.${outputId}`,
          message: "Output has neither template, inline_template, nor source",
          severity: "error",
        });
        continue;
      }

      const shouldSkipEmpty = outputDef.skip_empty === true;
      const isPatch = outputDef.mode === "patch";

      // If group_by is set, render once per group
      if (outputDef.group_by) {
        const groupField = outputDef.group_by;
        const groups = new Map<string, typeof checkResult.resolved>();

        for (const rc of checkResult.resolved) {
          const key = String(
            (rc.check as Record<string, unknown>)[groupField] ?? "default",
          );
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key)!.push(rc);
        }

        for (const [groupKey, groupChecks] of groups) {
          const groupCtx = {
            ...ctx,
            resolved_checks: groupChecks,
            current_group: groupKey,
          };
          const compiled = Handlebars.compile(templateContent, { noEscape: true });
          const rendered = compiled(groupCtx);

          const groupTarget = resolve(targetPath, groupKey);

          if (shouldSkipEmpty && rendered.trim().length === 0) {
            if (!dryRun) {
              try { await unlink(groupTarget); } catch { /* not found */ }
            }
            continue;
          }

          const output = isPatch && !dryRun
            ? await applyPatch(groupTarget, rendered, outputDef)
            : rendered;

          if (!dryRun) {
            await mkdir(dirname(groupTarget), { recursive: true });
            await writeFile(groupTarget, output, "utf8");
            if (outputDef.executable) {
              await chmod(groupTarget, 0o755);
            }
          }
          outputFiles.push(groupTarget);
        }
      } else {
        const compiled = Handlebars.compile(templateContent, { noEscape: true });
        const rendered = compiled(ctx);

        if (shouldSkipEmpty && rendered.trim().length === 0) {
          if (!dryRun) {
            try { await unlink(targetPath); } catch { /* not found */ }
          }
        } else {
          const output = isPatch && !dryRun
            ? await applyPatch(targetPath, rendered, outputDef)
            : rendered;

          if (!dryRun) {
            await mkdir(dirname(targetPath), { recursive: true });
            await writeFile(targetPath, output, "utf8");
            if (outputDef.executable) {
              await chmod(targetPath, 0o755);
            }
          }
          outputFiles.push(targetPath);
        }
      }
    }

    // Process binding renders (entity-iteration rendering with full DSL context)
    for (const renderTarget of binding.renders ?? []) {
      let templateContent: string;
      if (renderTarget.inline_template) {
        templateContent = renderTarget.inline_template;
      } else if (renderTarget.template) {
        const templatePath = resolve(config.configDir, renderTarget.template);
        try {
          templateContent = await readFile(templatePath, "utf8");
        } catch {
          diagnostics.push({
            path: `binding.${binding.software}.renders`,
            message: `Template file not found: ${templatePath}`,
            severity: "error",
          });
          continue;
        }
      } else {
        diagnostics.push({
          path: `binding.${binding.software}.renders`,
          message: "Render target has neither template nor inline_template",
          severity: "error",
        });
        continue;
      }

      const compiled = Handlebars.compile(templateContent, { noEscape: true });
      const shouldSkipEmpty = renderTarget.skip_empty === true;
      const context = renderTarget.context as ContextType;

      if (context === "system" || context === "navigation_index") {
        const baseCtx =
          context === "system"
            ? buildSystemContext(dsl)
            : (buildNavigationIndex(dsl) as unknown as Record<string, unknown>);
        const mergedCtx = { ...baseCtx, vars, paths, binding, resolved_checks: checkResult.resolved };
        const rendered = compiled(mergedCtx);

        const resolvedOutput = resolveBindingRenderOutputPath(renderTarget.output, paths);
        const outputPath = resolve(config.configDir, resolvedOutput);

        if (shouldSkipEmpty && rendered.trim().length === 0) {
          if (!dryRun) {
            try { await unlink(outputPath); } catch { /* not found */ }
          }
          continue;
        }

        if (!dryRun) {
          await mkdir(dirname(outputPath), { recursive: true });
          await writeFile(outputPath, rendered, "utf8");
          if (renderTarget.executable) {
            await chmod(outputPath, 0o755);
          }
        }
        outputFiles.push(outputPath);
      } else {
        const section = getDslSection(dsl, context);
        const allIds = Object.keys(section);
        const ids = filterIds(allIds, renderTarget.include, renderTarget.exclude);

        for (const entityId of ids) {
          const entityCtx = buildEntityContext(dsl, context, entityId);
          const mergedCtx = { ...entityCtx, vars, paths, binding, resolved_checks: checkResult.resolved };
          const rendered = compiled(mergedCtx);

          const entity = section[entityId] as Record<string, unknown> | undefined;
          const expandedOutput = expandOutputPath(renderTarget.output, context, entityId, entity);
          if (hasUnresolvedPathVars(expandedOutput)) continue;
          const resolvedOutput = resolveBindingRenderOutputPath(expandedOutput, paths);
          const outputPath = resolve(config.configDir, resolvedOutput);

          if (shouldSkipEmpty && rendered.trim().length === 0) {
            if (!dryRun) {
              try { await unlink(outputPath); } catch { /* not found */ }
            }
            continue;
          }

          if (!dryRun) {
            await mkdir(dirname(outputPath), { recursive: true });
            await writeFile(outputPath, rendered, "utf8");
            if (renderTarget.executable) {
              await chmod(outputPath, 0o755);
            }
          }
          outputFiles.push(outputPath);
        }
      }
    }
  }

  return { outputFiles, diagnostics };
}

/**
 * Resolve path variables ({name}) from config.paths in binding render output paths.
 * Uses the same {var} syntax as binding outputs target paths.
 */
function resolveBindingRenderOutputPath(
  output: string,
  paths: Record<string, string>,
): string {
  return output.replace(/\{(\w+)\}/g, (match, varName: string) => {
    const value = paths[varName];
    return value !== undefined ? value : match;
  });
}
