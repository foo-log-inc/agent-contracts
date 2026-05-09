/**
 * Audit orchestrator — runs LLM-based semantic audits via agent-contracts-runtime.
 *
 * Uses the auto-generated contracts from dsl_base/ (agentRegistry, taskRegistry,
 * handoffSchemas) and the runtime's runTask() for execution, follow-up recovery,
 * and handoff schema validation.
 *
 * agent-contracts-runtime is an optional peer dependency — it is loaded
 * dynamically at audit invocation time so that users who don't use audit
 * have zero additional overhead.
 */

import type { Dsl } from "../schema/index.js";
import type { ResolvedConfig } from "../config/types.js";
import type { AuditType, AuditConfig, AuditOptions } from "./types.js";
import { buildAuditContext } from "./context-builder.js";

import {
  agentRegistry,
  taskRegistry,
  handoffSchemas,
} from "../generated/dsl-base/index.js";
import type { DslAuditResult } from "../generated/dsl-base/handoffs.js";

const AUDIT_TYPE_TO_TASK: Record<AuditType, string> = {
  render: "audit-dsl-completeness",
  dsl: "audit-semantic-design",
  prompt: "audit-generated-prompts",
};

export interface AuditRunResult {
  taskId: string;
  auditType: AuditType;
  data: DslAuditResult | null;
  raw: string;
  prompt: string;
  dryRun: boolean;
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

  if (options.dryRun) {
    return {
      taskId,
      auditType: options.auditType,
      data: null,
      raw: "",
      prompt: userRequest,
      dryRun: true,
      status: "success",
      followUpsUsed: 0,
      retriesUsed: 0,
    };
  }

  // Dynamic import — agent-contracts-runtime is optional.
  // Module names are constructed to prevent TypeScript from resolving them at compile time.
  const RUNTIME_PKG = ["agent-contracts", "runtime"].join("-");
  const MOCK_PKG = `${RUNTIME_PKG}/adapters/mock`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let runTask: (...args: any[]) => Promise<any>;
  try {
    const runtime = await import(RUNTIME_PKG);
    runTask = runtime.runTask;
  } catch {
    throw new Error(
      "agent-contracts-runtime is not installed. " +
      "Install it to use the audit command, or use --dry-run to inspect the prompt.\n" +
      "  npm install agent-contracts-runtime",
    );
  }

  const adapterName = auditConfig.adapter ?? "mock";
  let adapter: unknown;
  if (adapterName === "mock") {
    try {
      const mockMod = await import(MOCK_PKG);
      adapter = new mockMod.MockAdapter();
    } catch {
      throw new Error(
        "Failed to load mock adapter from agent-contracts-runtime.",
      );
    }
  } else {
    throw new Error(
      `Unsupported audit adapter: "${adapterName}". ` +
      "Available: mock. For other adapters, install the corresponding SDK package.",
    );
  }

  const result = await runTask(adapter, taskId, {
    user_request: userRequest,
  }, {
    maxFollowUps: 2,
    maxRetries: 0,
    agentRegistry,
    taskRegistry,
    handoffSchemas,
  });

  const outcome = result.outcome;
  return {
    taskId,
    auditType: options.auditType,
    data: outcome.status === "success" ? (outcome.data as DslAuditResult) : null,
    raw: (outcome.raw as string) ?? "",
    prompt: userRequest,
    dryRun: false,
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
  const types: AuditType[] = ["render", "dsl", "prompt"];
  const results: AuditRunResult[] = [];
  for (const auditType of types) {
    results.push(await runAudit(dsl, config, auditConfig, { ...options, auditType }));
  }
  return results;
}
