import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import Handlebars from "handlebars";
import type { Dsl } from "../schema/index.js";
import { resolveAllOf } from "../schema/index.js";
import type { ResolvedRenderTarget, ContextType } from "../config/types.js";
import type { LoadedBinding } from "../config/binding-loader.js";
import {
  buildPerAgentContext,
  buildSystemContext,
  buildTaskContext,
  buildArtifactContext,
  buildToolContext,
  buildValidationContext,
  buildHandoffTypeContext,
  buildWorkflowContext,
  buildPolicyContext,
  buildGuardrailContext,
  buildGuardrailPolicyContext,
} from "./context.js";
import { generateSequenceDiagram } from "./sequence-diagram.js";
import { generateOverviewFlowchart } from "./overview-flowchart.js";

Handlebars.registerHelper("eq", (a: unknown, b: unknown) => a === b);

Handlebars.registerHelper("notEmpty", (obj: unknown) => {
  if (!obj || typeof obj !== "object") return false;
  return Object.keys(obj as Record<string, unknown>).length > 0;
});

Handlebars.registerHelper("inc", (val: number) => val + 1);

interface PayloadFieldInfo {
  name: string;
  type: string;
  required: boolean;
  enum?: string;
}

Handlebars.registerHelper(
  "lookupPayloadFields",
  (schema: Record<string, unknown>): PayloadFieldInfo[] => {
    const effective = resolveAllOf(schema ?? {});
    const props = effective["properties"] as
      | Record<string, Record<string, unknown>>
      | undefined;
    if (!props) return [];
    const requiredSet = new Set(
      (effective["required"] as string[] | undefined) ?? [],
    );
    return Object.entries(props).map(([name, sub]) => {
      const enumVals = sub["enum"] as string[] | undefined;
      return {
        name,
        type: (sub["type"] as string) ?? "any",
        required: requiredSet.has(name),
        enum: enumVals ? enumVals.join(" | ") : undefined,
      };
    });
  },
);

function toYamlLines(obj: unknown, indent: number): string[] {
  const pad = "  ".repeat(indent);
  if (obj === null || obj === undefined) return [`${pad}null`];
  if (typeof obj === "boolean" || typeof obj === "number")
    return [`${pad}${obj}`];
  if (typeof obj === "string") {
    if (obj.includes("\n")) {
      const lines = [`${pad}|`];
      for (const line of obj.split("\n")) {
        lines.push(line === "" ? "" : `${pad}  ${line}`);
      }
      return lines;
    }
    return [`${pad}${JSON.stringify(obj)}`];
  }
  if (Array.isArray(obj)) {
    const lines: string[] = [];
    for (const item of obj) {
      if (typeof item === "object" && item !== null && !Array.isArray(item)) {
        const entries = Object.entries(item as Record<string, unknown>);
        if (entries.length > 0) {
          const [firstKey, firstVal] = entries[0];
          const firstValLines = toYamlLines(firstVal, 0);
          if (firstValLines.length === 1 && !firstValLines[0].includes("\n")) {
            lines.push(`${pad}- ${firstKey}: ${firstValLines[0].trim()}`);
          } else {
            lines.push(`${pad}- ${firstKey}:`);
            lines.push(...toYamlLines(firstVal, indent + 2));
          }
          for (let i = 1; i < entries.length; i++) {
            const [k, v] = entries[i];
            const vLines = toYamlLines(v, indent + 2);
            if (vLines.length === 1) {
              lines.push(`${pad}  ${k}: ${vLines[0].trim()}`);
            } else {
              lines.push(`${pad}  ${k}:`);
              lines.push(...vLines);
            }
          }
        } else {
          lines.push(`${pad}- {}`);
        }
      } else {
        const valLines = toYamlLines(item, 0);
        lines.push(`${pad}- ${valLines[0].trim()}`);
      }
    }
    return lines;
  }
  if (typeof obj === "object") {
    const lines: string[] = [];
    for (const [key, value] of Object.entries(
      obj as Record<string, unknown>,
    )) {
      const valLines = toYamlLines(value, indent + 1);
      if (valLines.length === 1 && !valLines[0].includes("|")) {
        lines.push(`${pad}${key}: ${valLines[0].trim()}`);
      } else {
        lines.push(`${pad}${key}:`);
        lines.push(...valLines);
      }
    }
    return lines;
  }
  return [`${pad}${String(obj)}`];
}

Handlebars.registerHelper("yamlBlock", (obj: unknown): string => {
  return toYamlLines(obj, 0).join("\n");
});

Handlebars.registerHelper(
  "join",
  (arr: unknown, separator: unknown): string => {
    if (!Array.isArray(arr)) return "";
    const sep = typeof separator === "string" ? separator : ", ";
    return arr.join(sep);
  },
);

Handlebars.registerHelper("contains", (arr: unknown, value: unknown): boolean => {
  if (!Array.isArray(arr)) return false;
  return arr.includes(value);
});

Handlebars.registerHelper(
  "groupBy",
  (arr: unknown, key: string): Record<string, unknown[]> => {
    if (!Array.isArray(arr)) return {};
    const result: Record<string, unknown[]> = {};
    for (const item of arr) {
      const k = String(
        (item as Record<string, unknown>)?.[key] ?? "undefined",
      );
      (result[k] ??= []).push(item);
    }
    return result;
  },
);

Handlebars.registerHelper(
  "keys",
  (obj: unknown): string[] => {
    if (!obj || typeof obj !== "object") return [];
    return Object.keys(obj as Record<string, unknown>);
  },
);

Handlebars.registerHelper(
  "values",
  (obj: unknown): unknown[] => {
    if (!obj || typeof obj !== "object") return [];
    return Object.values(obj as Record<string, unknown>);
  },
);

Handlebars.registerHelper(
  "filterByField",
  (arr: unknown, field: string, value: unknown): unknown[] => {
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (item) => (item as Record<string, unknown>)?.[field] === value,
    );
  },
);

Handlebars.registerHelper("not", (value: unknown): boolean => !value);

Handlebars.registerHelper("or", (...args: unknown[]): boolean => {
  const _options = args.pop();
  return args.some((a) => !!a);
});

Handlebars.registerHelper("coalesce", (...args: unknown[]): unknown => {
  const _options = args.pop();
  return args.find((a) => a != null && a !== false && a !== "");
});

Handlebars.registerHelper("and", (...args: unknown[]): boolean => {
  const _options = args.pop();
  return args.every((a) => !!a);
});

Handlebars.registerHelper("gt", (a: number, b: number): boolean => a > b);

Handlebars.registerHelper("gte", (a: number, b: number): boolean => a >= b);

Handlebars.registerHelper("lt", (a: number, b: number): boolean => a < b);

Handlebars.registerHelper("size", (obj: unknown): number => {
  if (Array.isArray(obj)) return obj.length;
  if (obj && typeof obj === "object") return Object.keys(obj as Record<string, unknown>).length;
  return 0;
});

Handlebars.registerHelper(
  "sequenceDiagram",
  function (this: Record<string, unknown>, ...args: unknown[]): string {
    const opts = args[args.length - 1] as { hash?: Record<string, unknown> };
    const positionalArgs = args.slice(0, -1);

    if (typeof positionalArgs[0] === "string" && positionalArgs[1]) {
      const workflowId = positionalArgs[0] as string;
      const dsl = positionalArgs[1] as Dsl;
      if (!dsl.workflow[workflowId]) return "";
      const ctx = buildWorkflowContext(dsl, workflowId);
      return generateSequenceDiagram(
        ctx.workflow as Parameters<typeof generateSequenceDiagram>[0],
        ctx.relatedTasks as Parameters<typeof generateSequenceDiagram>[1],
        dsl,
      );
    }

    const workflow = this["workflow"] as Parameters<typeof generateSequenceDiagram>[0];
    const relatedTasks = this["relatedTasks"] as Parameters<typeof generateSequenceDiagram>[1];
    const dsl = (opts?.hash?.["dsl"] ?? this["dsl"]) as Parameters<typeof generateSequenceDiagram>[2];
    if (!workflow || !dsl) return "";
    return generateSequenceDiagram(workflow, relatedTasks ?? [], dsl);
  },
);

Handlebars.registerHelper(
  "overviewFlowchart",
  function (this: Record<string, unknown>, ...args: unknown[]): string {
    const positionalArgs = args.slice(0, -1);

    if (positionalArgs[0] && typeof positionalArgs[0] === "object") {
      return generateOverviewFlowchart(positionalArgs[0] as Dsl);
    }

    const dsl = this["dsl"] as Dsl | undefined;
    if (!dsl) return "";
    return generateOverviewFlowchart(dsl);
  },
);

Handlebars.registerHelper(
  "guardrailCoverageMatrix",
  function (this: Record<string, unknown>): string {
    const enforcement = this["guardrailEnforcement"] as Array<Record<string, unknown>> | undefined;
    if (!enforcement || enforcement.length === 0) return "";

    const header = "| Guardrail | Severity | Action | Agents | Tasks | Workflows | Tools | Artifacts | Trigger | Override | Escalation |";
    const divider = "|-----------|----------|--------|--------|-------|-----------|-------|-----------|---------|----------|------------|";
    const rows = enforcement.map((e) => {
      const agents = (e["scoped_agents"] as string[])?.join(", ") || "—";
      const tasks = (e["scoped_tasks"] as string[])?.join(", ") || "—";
      const workflows = (e["scoped_workflows"] as string[])?.join(", ") || "—";
      const tools = (e["scoped_tools"] as string[])?.join(", ") || "—";
      const artifacts = (e["scoped_artifacts"] as string[])?.join(", ") || "—";
      const trigger = (e["trigger"] as string) || "—";
      const override = e["allow_override"] ? "yes" : "no";
      const esc = e["escalation"] as Record<string, string> | null;
      const escalation = esc ? esc["target"] : "—";
      return `| ${e["guardrail_id"]} | ${e["severity"]} | ${e["action"]} | ${agents} | ${tasks} | ${workflows} | ${tools} | ${artifacts} | ${trigger} | ${override} | ${escalation} |`;
    });

    return [header, divider, ...rows].join("\n");
  },
);

Handlebars.registerHelper(
  "taskGuardrailMatrix",
  function (this: Record<string, unknown>): string {
    const dsl = this["dsl"] as Dsl | undefined;
    const enforcement = this["guardrailEnforcement"] as Array<Record<string, unknown>> | undefined;
    if (!dsl || !enforcement || enforcement.length === 0) return "";

    const taskIds = Object.keys(dsl.tasks);
    if (taskIds.length === 0) return "";

    const guardrailIds = enforcement.map((e) => e["guardrail_id"] as string);
    const header = `| Task | ${guardrailIds.join(" | ")} |`;
    const divider = `|------|${guardrailIds.map(() => "------").join("|")}|`;

    const rows = taskIds.map((taskId) => {
      const cells = enforcement.map((e) => {
        const scopedTasks = e["scoped_tasks"] as string[];
        if (scopedTasks.length > 0 && !scopedTasks.includes(taskId)) return "n/a";
        return e["action"] as string;
      });
      return `| ${taskId} | ${cells.join(" | ")} |`;
    });

    return [header, divider, ...rows].join("\n");
  },
);

export interface RenderOptions {
  loadedBindings?: LoadedBinding[];
  activeGuardrailPolicy?: string;
}

export function getDslSection(dsl: Dsl, context: ContextType): Record<string, unknown> {
  const sectionMap: Record<string, Record<string, unknown>> = {
    agent: dsl.agents,
    task: dsl.tasks,
    artifact: dsl.artifacts,
    tool: dsl.tools,
    validation: dsl.validations,
    handoff_type: dsl.handoff_types,
    workflow: dsl.workflow,
    policy: dsl.policies,
    guardrail: dsl.guardrails,
    guardrail_policy: dsl.guardrail_policies,
  };
  return sectionMap[context] ?? {};
}

export function filterIds(
  allIds: string[],
  include?: string[],
  exclude?: string[],
): string[] {
  if (include) return allIds.filter((id) => include.includes(id));
  if (exclude) return allIds.filter((id) => !exclude.includes(id));
  return allIds;
}

export function expandOutputPath(
  pattern: string,
  context: ContextType,
  entityId: string,
  entity?: Record<string, unknown>,
): string {
  return pattern.replace(
    new RegExp(`\\{${context}\\.([^}]+)\\}`, "g"),
    (_match, field: string) => {
      if (field === "id") return entityId;
      if (entity === undefined) return _match;
      const value = entity[field];
      return typeof value === "string" ? value : _match;
    },
  );
}

import { CONTEXT_TYPES } from "../schema/context-type.js";

const CONTEXT_TYPE_PATTERN = new RegExp(
  `\\{(${CONTEXT_TYPES.join("|")})\\.[^}]+\\}`,
);

export function hasUnresolvedPathVars(path: string): boolean {
  return CONTEXT_TYPE_PATTERN.test(path);
}

export function buildEntityContext(
  dsl: Dsl,
  context: ContextType,
  entityId: string,
): Record<string, unknown> {
  switch (context) {
    case "agent": {
      const agentDef = dsl.agents[entityId];
      const agentWithId = { ...agentDef, id: entityId };
      return buildPerAgentContext(dsl, agentWithId);
    }
    case "task":
      return buildTaskContext(dsl, entityId);
    case "artifact":
      return buildArtifactContext(dsl, entityId);
    case "tool":
      return buildToolContext(dsl, entityId);
    case "validation":
      return buildValidationContext(dsl, entityId);
    case "handoff_type":
      return buildHandoffTypeContext(dsl, entityId);
    case "workflow":
      return buildWorkflowContext(dsl, entityId);
    case "policy":
      return buildPolicyContext(dsl, entityId);
    case "guardrail":
      return buildGuardrailContext(dsl, entityId);
    case "guardrail_policy":
      return buildGuardrailPolicyContext(dsl, entityId);
    case "system":
      return buildSystemContext(dsl);
  }
}

async function loadTemplate(templatePath: string): Promise<string> {
  return readFile(templatePath, "utf8");
}

function isEffectivelyEmpty(output: string): boolean {
  return output.trim().length === 0;
}

async function removeIfExists(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch {
    // file does not exist — nothing to remove
  }
}

export async function renderFromConfig(
  dsl: Dsl,
  renderTargets: ResolvedRenderTarget[],
  options?: RenderOptions,
): Promise<string[]> {
  const outputFiles: string[] = [];

  for (const target of renderTargets) {
    const templateContent = await loadTemplate(target.template);
    const compiled = Handlebars.compile(templateContent, { noEscape: false });

    if (target.context === "system") {
      const ctx = buildSystemContext(dsl, options);
      const output = compiled(ctx);
      if (target.skip_empty && isEffectivelyEmpty(output)) {
        await removeIfExists(target.output);
        continue;
      }
      await mkdir(dirname(target.output), { recursive: true });
      await writeFile(target.output, output, "utf8");
      outputFiles.push(target.output);
    } else {
      const section = getDslSection(dsl, target.context);
      const allIds = Object.keys(section);
      const ids = filterIds(allIds, target.include, target.exclude);

      for (const entityId of ids) {
        const ctx = buildEntityContext(dsl, target.context, entityId);
        const output = compiled(ctx);
        const entity = section[entityId] as Record<string, unknown> | undefined;
        const outputPath = expandOutputPath(target.output, target.context, entityId, entity);
        if (hasUnresolvedPathVars(outputPath)) continue;
        if (target.skip_empty && isEffectivelyEmpty(output)) {
          await removeIfExists(outputPath);
          continue;
        }
        await mkdir(dirname(outputPath), { recursive: true });
        await writeFile(outputPath, output, "utf8");
        outputFiles.push(outputPath);
      }
    }
  }

  return outputFiles;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await readFile(filePath);
    return true;
  } catch {
    return false;
  }
}

function checkExpectedVsExisting(
  expected: string,
  outputPath: string,
  skipEmpty: boolean | undefined,
  diffs: string[],
): Promise<void> {
  if (skipEmpty && isEffectivelyEmpty(expected)) {
    return fileExists(outputPath).then((exists) => {
      if (exists) diffs.push(outputPath);
    });
  }
  return readFile(outputPath, "utf8")
    .then((existing) => {
      if (existing !== expected) diffs.push(outputPath);
    })
    .catch(() => {
      diffs.push(outputPath);
    });
}

export async function checkDriftFromConfig(
  dsl: Dsl,
  renderTargets: ResolvedRenderTarget[],
  options?: RenderOptions,
): Promise<{ hasDrift: boolean; diffs: string[] }> {
  const diffs: string[] = [];

  for (const target of renderTargets) {
    const templateContent = await loadTemplate(target.template);
    const compiled = Handlebars.compile(templateContent, { noEscape: false });

    if (target.context === "system") {
      const ctx = buildSystemContext(dsl, options);
      const expected = compiled(ctx);
      await checkExpectedVsExisting(expected, target.output, target.skip_empty, diffs);
    } else {
      const section = getDslSection(dsl, target.context);
      const allIds = Object.keys(section);
      const ids = filterIds(allIds, target.include, target.exclude);

      for (const entityId of ids) {
        const ctx = buildEntityContext(dsl, target.context, entityId);
        const expected = compiled(ctx);
        const entity = section[entityId] as Record<string, unknown> | undefined;
        const outputPath = expandOutputPath(target.output, target.context, entityId, entity);
        if (hasUnresolvedPathVars(outputPath)) continue;
        await checkExpectedVsExisting(expected, outputPath, target.skip_empty, diffs);
      }
    }
  }

  return { hasDrift: diffs.length > 0, diffs };
}
