import { readFile, writeFile, mkdir, chmod, unlink, copyFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import Handlebars from "handlebars";
import YAML from "yaml";
import type { Dsl } from "../schema/index.js";
import type { ResolvedConfig } from "../config/types.js";
import type { LoadedBinding } from "../config/binding-loader.js";
import type { BindingOutput } from "../schema/index.js";
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
} from "../renderer/index.js";

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

async function applyPatch(
  targetPath: string,
  patchContent: string,
  outputDef: BindingOutput,
): Promise<string> {
  const format = outputDef.format ?? "json";

  if (format === "text") {
    let existing = "";
    try {
      existing = await readFile(targetPath, "utf8");
    } catch { /* first write */ }
    return existing + patchContent;
  }

  const patchData = parseContent(patchContent, format);

  let existingData: unknown;
  try {
    const existingRaw = await readFile(targetPath, "utf8");
    existingData = parseContent(existingRaw, format);
  } catch {
    return serializeContent(patchData, format);
  }

  const strategy = outputDef.patch_strategy ?? "deep_merge";
  if (strategy === "append" && Array.isArray(existingData)) {
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
    const binding = lb.binding;

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

      // --- source: file copy without template processing ---
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

      // --- template / inline_template rendering ---
      let templateContent: string;
      if (outputDef.inline_template) {
        templateContent = outputDef.inline_template;
      } else if (outputDef.template) {
        if (outputDef.template.startsWith("builtin:")) {
          diagnostics.push({
            path: `binding.${binding.software}.outputs.${outputId}`,
            message: `Builtin template "${outputDef.template}" is not yet implemented — skipping`,
            severity: "info",
          });
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

      if (context === "system") {
        const sysCtx = buildSystemContext(dsl);
        const mergedCtx = { ...sysCtx, vars, paths, binding, resolved_checks: checkResult.resolved };
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
          const resolvedOutput = resolveBindingRenderOutputPath(
            expandOutputPath(renderTarget.output, context, entityId, entity),
            paths,
          );
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
