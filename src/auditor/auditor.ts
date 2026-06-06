/**
 * Audit orchestrator — runs LLM-based semantic audits via agent-contracts-runtime.
 *
 * Uses executeTask() from agent-contracts-runtime for the complete execution
 * lifecycle: adapter creation, DSL context loading, progress sink, and task invocation.
 *
 * agent-contracts-runtime is an optional peer dependency — it is loaded
 * dynamically at audit invocation time so that users who don't use audit
 * have zero additional overhead.
 */

import type { Dsl } from "../schema/index.js";
import type { ResolvedConfig } from "../config/types.js";
import type { AuditType, AuditConfig, AuditOptions } from "./types.js";
import { buildAuditContext } from "./context-builder.js";

import { resolvedDsl } from "../generated/dsl-base/index.js";
import type { DslAuditResult } from "../generated/dsl-base/handoffs.js";

const AUDIT_TYPE_TO_TASK: Record<AuditType, string> = {
  render: "audit-dsl-completeness",
  dsl: "audit-semantic-design",
  prompt: "audit-generated-prompts",
  extensions: "audit-extension-consumption",
};

export interface AuditRunResult {
  taskId: string;
  auditType: AuditType;
  data: DslAuditResult | null;
  raw: string;
  prompt: string;
  showPrompt: boolean;
  status: "success" | "validation_error" | "escalation" | "error";
  errorMessage?: string;
  followUpsUsed: number;
  retriesUsed: number;
}

export async function runAudit(
  dsl: Dsl,
  config: ResolvedConfig,
  auditConfig: AuditConfig,
  options: AuditOptions,
): Promise<AuditRunResult> {
  const taskId = AUDIT_TYPE_TO_TASK[options.auditType];
  const userRequest = await buildAuditContext(options.auditType, dsl, config);

  if (options.showPrompt) {
    return {
      taskId,
      auditType: options.auditType,
      data: null,
      raw: "",
      prompt: userRequest,
      showPrompt: true,
      status: "success",
      followUpsUsed: 0,
      retriesUsed: 0,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let executeTask: (taskId: string, options: any) => Promise<any>;
  try {
    const runtime = await import("agent-contracts-runtime");
    executeTask = runtime.executeTask;
  } catch {
    throw new Error(
      "agent-contracts-runtime is not installed. " +
      "Install it to use the audit command, or use --show-prompt to inspect the prompt.\n" +
      "  npm install agent-contracts-runtime",
    );
  }

  const result = await executeTask(taskId, {
    request: userRequest,
    adapter: auditConfig.adapter ?? "mock",
    model: auditConfig.model,
    dsl: resolvedDsl,
    logFile: options.logFile,
    maxFollowUps: 2,
    maxRetries: 0,
  });

  const outcome = result.outcome;
  return {
    taskId,
    auditType: options.auditType,
    data: outcome.status === "success" ? (outcome.data as DslAuditResult) : null,
    raw: (outcome.raw as string) ?? "",
    prompt: userRequest,
    showPrompt: false,
    status: outcome.status as AuditRunResult["status"],
    errorMessage:
      outcome.status === "error" ? outcome.message :
      outcome.status === "escalation" ? outcome.reason :
      outcome.status === "validation_error" ? outcome.errors?.message :
      undefined,
    followUpsUsed: result.follow_ups_used,
    retriesUsed: result.retries_used,
  };
}

export async function runAllAudits(
  dsl: Dsl,
  config: ResolvedConfig,
  auditConfig: AuditConfig,
  options: Omit<AuditOptions, "auditType">,
): Promise<AuditRunResult[]> {
  const types: AuditType[] = ["render", "dsl", "prompt", "extensions"];
  const results: AuditRunResult[] = [];
  for (const auditType of types) {
    results.push(await runAudit(dsl, config, auditConfig, { ...options, auditType }));
  }
  return results;
}
