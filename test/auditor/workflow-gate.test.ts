/**
 * Integration test — verifies that gate steps in the dsl-audit workflow
 * are evaluated via LLM when no onGate callback is provided.
 *
 * Exercises agent-contracts-runtime v0.13.1+ gate evaluation logic.
 */

import { describe, it, expect } from "vitest";
import { runWorkflow } from "agent-contracts-runtime";
import type { SdkAdapter } from "agent-contracts-runtime";

import {
  agentRegistry,
  taskRegistry,
  handoffSchemas,
  workflowRegistry,
} from "../../src/generated/dsl-base/index.js";

function makeAuditResult(overrides: Record<string, unknown> = {}): string {
  const data = {
    audit_type: "completeness",
    total_dimensions: 19,
    pass_count: 17,
    miss_count: 2,
    critical_gaps: [],
    recommendations: [],
    ...overrides,
  };
  return `\`\`\`json\n${JSON.stringify(data)}\n\`\`\``;
}

function createGateAwareAdapter(opts: {
  taskResponses: Record<string, string>;
  gateApproval: boolean;
}): SdkAdapter & { gateCalls: string[] } {
  const gateCalls: string[] = [];
  return {
    gateCalls,
    async send(prompt: string): Promise<string> {
      if (prompt.includes("gate evaluator")) {
        gateCalls.push(prompt);
        return JSON.stringify({
          approved: opts.gateApproval,
          reason: opts.gateApproval ? "condition satisfied" : "condition not met",
        });
      }
      const match = prompt.match(/## Task: (\S+)/);
      const taskId = match?.[1] ?? "";
      return opts.taskResponses[taskId] ?? "";
    },
  };
}

describe("workflow gate — LLM evaluation (dsl-audit)", () => {
  const registries = {
    workflowRegistry: workflowRegistry as Record<string, typeof workflowRegistry[keyof typeof workflowRegistry]>,
    taskRegistry: taskRegistry as Record<string, typeof taskRegistry[keyof typeof taskRegistry]>,
    agentRegistry: agentRegistry as Record<string, typeof agentRegistry[keyof typeof agentRegistry]>,
    handoffSchemas: handoffSchemas as Record<string, unknown>,
  };

  it("gate approves via LLM when audit results are clean", async () => {
    const adapter = createGateAwareAdapter({
      taskResponses: {
        "audit-dsl-completeness": makeAuditResult({ miss_count: 0, critical_gaps: [] }),
        "audit-semantic-design": makeAuditResult({ audit_type: "semantic" }),
        "audit-generated-prompts": makeAuditResult({ audit_type: "prompt" }),
        "audit-extension-consumption": makeAuditResult({ audit_type: "extensions" }),
      },
      gateApproval: true,
    });

    const result = await runWorkflow(adapter, "dsl-audit", {
      user_request: "Run full audit",
    }, registries);

    expect(result.status).toBe("completed");
    expect(adapter.gateCalls.length).toBeGreaterThan(0);

    // Gate prompt should contain the gate description
    expect(adapter.gateCalls[0]).toContain("Block if audit-dsl-completeness detected 3 or more critical-level gaps");
    // Gate prompt should include prior step results
    expect(adapter.gateCalls[0]).toContain("audit-dsl-completeness");
    expect(adapter.gateCalls[0]).toContain("status=success");
  });

  it("gate rejects via LLM and aborts workflow", async () => {
    const adapter = createGateAwareAdapter({
      taskResponses: {
        "audit-dsl-completeness": makeAuditResult({
          miss_count: 5,
          critical_gaps: [
            { dimension: "purpose", severity: "critical" },
            { dimension: "mode", severity: "critical" },
            { dimension: "tools", severity: "critical" },
          ],
        }),
      },
      gateApproval: false,
    });

    const result = await runWorkflow(adapter, "dsl-audit", {
      user_request: "Run full audit",
    }, registries);

    expect(result.status).toBe("gate_rejected");
    // Only first delegate + first gate should have run
    expect(result.steps.length).toBe(2);
    expect(result.steps[1].gate_kind).toBe("dsl-audit-result");
    expect(result.steps[1].outcome.status).toBe("gate_rejected");
  });

  it("onGate callback takes priority over LLM evaluation", async () => {
    const adapter = createGateAwareAdapter({
      taskResponses: {
        "audit-dsl-completeness": makeAuditResult(),
        "audit-semantic-design": makeAuditResult({ audit_type: "semantic" }),
        "audit-generated-prompts": makeAuditResult({ audit_type: "prompt" }),
        "audit-extension-consumption": makeAuditResult({ audit_type: "extensions" }),
      },
      gateApproval: false, // LLM would reject
    });

    const result = await runWorkflow(adapter, "dsl-audit", {
      user_request: "Run full audit",
      onGate: async () => true, // callback approves
    }, registries);

    expect(result.status).toBe("completed");
    // LLM should NOT have been called for gate evaluation
    expect(adapter.gateCalls.length).toBe(0);
  });
});
