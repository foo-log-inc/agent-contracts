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

import { resolve } from "node:path";
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function createAdapter(name: string, config: AuditConfig): Promise<any> {
  switch (name) {
    case "mock": {
      const mod = await import("agent-contracts-runtime/adapters/mock");
      return new mod.MockAdapter();
    }
    case "cursor": {
      const mod = await import("agent-contracts-runtime/adapters/cursor-sdk");
      const apiKey = process.env.CURSOR_API_KEY;
      if (!apiKey) {
        throw new Error(
          "CURSOR_API_KEY environment variable is required for the cursor adapter.\n" +
          "Get your key from: https://cursor.com/dashboard/integrations",
        );
      }
      return mod.CursorSdkAdapter.create({ apiKey, model: config.model });
    }
    case "claude": {
      const mod = await import("agent-contracts-runtime/adapters/claude-agent-sdk");
      return new mod.ClaudeAgentSdkAdapter({
        model: config.model,
        tools: ["Read", "Glob", "Grep"],
        permissionMode: "bypassPermissions",
      });
    }
    case "openai": {
      const mod = await import("agent-contracts-runtime/adapters/openai-agents-sdk");
      return new mod.OpenAIAgentsSdkAdapter({
        model: config.model,
        maxTurns: 1,
      });
    }
    case "gemini": {
      const mod = await import("agent-contracts-runtime/adapters/gemini-sdk");
      return new mod.GeminiSdkAdapter({
        apiKey: process.env.GEMINI_API_KEY,
        model: config.model ?? "gemini-2.5-flash",
        temperature: config.temperature,
      });
    }
    default:
      throw new Error(
        `Unsupported audit adapter: "${name}". ` +
        "Available: mock, cursor, claude, openai, gemini.",
      );
  }
}

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
  let runTask: (...args: any[]) => Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let createProgressSink: (options: any) => { write: (chunk: string) => void; close: () => void };
  try {
    const runtime = await import("agent-contracts-runtime");
    runTask = runtime.runTask;
    createProgressSink = runtime.createProgressSink;
  } catch {
    throw new Error(
      "agent-contracts-runtime is not installed. " +
      "Install it to use the audit command, or use --show-prompt to inspect the prompt.\n" +
      "  npm install agent-contracts-runtime",
    );
  }

  const adapterName = auditConfig.adapter ?? "mock";
  const adapter = await createAdapter(adapterName, auditConfig);

  const progressSink = options.logFile
    ? createProgressSink({ stderr: true, file: resolve(options.logFile), naming: "single" })
    : createProgressSink({ stderr: true });

  try {
    const result = await runTask(adapter, taskId, {
      user_request: userRequest,
    }, {
      maxFollowUps: 2,
      maxRetries: 0,
      progressOutput: progressSink,
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
  } finally {
    progressSink.close();
  }
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
