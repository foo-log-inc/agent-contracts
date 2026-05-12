/**
 * E2E verification script — runs dsl-audit workflow via runWorkflow with
 * a mock adapter that produces realistic audit outputs, demonstrating
 * LLM-based gate evaluation from agent-contracts-runtime v0.13.1.
 */

import { runWorkflow } from "agent-contracts-runtime";
import type { SdkAdapter } from "agent-contracts-runtime";

import {
  agentRegistry,
  taskRegistry,
  handoffSchemas,
  workflowRegistry,
} from "../../src/generated/dsl-base/index.js";

// Realistic mock — produces valid DslAuditResult payloads and gate evaluation responses
function createRealisticMockAdapter(): SdkAdapter & { log: string[] } {
  const log: string[] = [];
  return {
    log,
    async send(prompt: string): Promise<string> {
      // Gate evaluation request
      if (prompt.includes("gate evaluator")) {
        const gateKind = prompt.match(/kind: (.+)/)?.[1] ?? "unknown";
        log.push(`[GATE] LLM evaluating gate: ${gateKind}`);

        // Simulate LLM reasoning about the gate condition
        if (prompt.includes("3 or more critical-level gaps")) {
          // First gate: check critical gaps from audit-dsl-completeness
          if (prompt.includes("miss_count") && prompt.includes('"miss_count":1')) {
            log.push(`[GATE] → APPROVED (only 1 miss, threshold is 3)`);
            return JSON.stringify({
              approved: true,
              reason: "audit-dsl-completeness found 1 miss which is below the 3 critical-gap threshold",
            });
          }
          log.push(`[GATE] → APPROVED (no critical gaps detected in context)`);
          return JSON.stringify({
            approved: true,
            reason: "No evidence of 3 or more critical-level gaps in prior results",
          });
        }

        if (prompt.includes("hallucinated permissions")) {
          // Terminal gate: check hallucinated permissions
          log.push(`[GATE] → APPROVED (no hallucinated permissions detected)`);
          return JSON.stringify({
            approved: true,
            reason: "audit-generated-prompts did not detect hallucinated permissions",
          });
        }

        log.push(`[GATE] → APPROVED (default)`);
        return JSON.stringify({ approved: true, reason: "condition satisfied" });
      }

      // Task execution — produce valid DslAuditResult
      const match = prompt.match(/## Task: (\S+)/);
      const taskId = match?.[1] ?? "unknown";
      log.push(`[TASK] Executing: ${taskId}`);

      const results: Record<string, object> = {
        "audit-dsl-completeness": {
          audit_type: "completeness",
          total_dimensions: 19,
          pass_count: 16,
          miss_count: 1,
          partial_count: 2,
          agents_reviewed: 2,
          critical_gaps: [
            { dimension: "x-audit-checklist", severity: "warning", gap_type: "dsl_gap" },
          ],
          recommendations: [
            { priority: "P1", description: "Add x-audit-checklist to dsl-designer", fix_type: "dsl_fix" },
          ],
        },
        "audit-semantic-design": {
          audit_type: "semantic",
          total_dimensions: 7,
          pass_count: 6,
          miss_count: 1,
          agents_reviewed: 2,
          gate_analysis_complete: true,
          guardrail_enforcement_verified: true,
          critical_gaps: [],
          recommendations: [
            { priority: "P2", description: "Consider narrowing dsl-designer scope", fix_type: "dsl_fix" },
          ],
        },
        "audit-generated-prompts": {
          audit_type: "prompt",
          total_dimensions: 5,
          pass_count: 5,
          miss_count: 0,
          prompts_reviewed: 2,
          critical_gaps: [],
          recommendations: [],
        },
      };

      const data = results[taskId] ?? { audit_type: "completeness", total_dimensions: 1, pass_count: 1, miss_count: 0 };
      return `\`\`\`json\n${JSON.stringify(data)}\n\`\`\``;
    },
  };
}

async function main() {
  console.log("=== agent-contracts DSL audit workflow — gate LLM evaluation check ===\n");
  console.log(`Runtime: agent-contracts-runtime v0.13.1`);
  console.log(`Workflow: dsl-audit (${workflowRegistry["dsl-audit"].steps.length} steps)\n`);

  const adapter = createRealisticMockAdapter();

  const registries = {
    workflowRegistry: workflowRegistry as Record<string, typeof workflowRegistry[keyof typeof workflowRegistry]>,
    taskRegistry: taskRegistry as Record<string, typeof taskRegistry[keyof typeof taskRegistry]>,
    agentRegistry: agentRegistry as Record<string, typeof agentRegistry[keyof typeof agentRegistry]>,
    handoffSchemas: handoffSchemas as Record<string, unknown>,
  };

  const result = await runWorkflow(adapter, "dsl-audit", {
    user_request: "Run full DSL audit on agent-contracts own definitions",
  }, registries);

  console.log("--- Execution Log ---");
  for (const entry of adapter.log) {
    console.log(`  ${entry}`);
  }

  console.log("\n--- Workflow Result ---");
  console.log(`  Status: ${result.status}`);
  console.log(`  Steps completed: ${result.steps.length}`);
  console.log(`  Total elapsed: ${result.total_elapsed_ms}ms`);

  console.log("\n--- Step Details ---");
  for (const step of result.steps) {
    const id = step.task_id ?? step.gate_kind ?? `step_${step.step_index}`;
    const type = step.gate_kind ? "gate" : "task";
    console.log(`  [${step.step_index}] ${type.padEnd(4)} ${id.padEnd(30)} → ${step.outcome.status}`);
  }

  // Verify gates were evaluated via LLM
  const gateEvals = adapter.log.filter((l) => l.startsWith("[GATE]"));
  console.log(`\n--- Gate Evaluation Summary ---`);
  console.log(`  Gates evaluated via LLM: ${gateEvals.filter((l) => l.includes("LLM evaluating")).length}`);
  console.log(`  Gates approved: ${gateEvals.filter((l) => l.includes("APPROVED")).length}`);
  console.log(`  Gates rejected: ${gateEvals.filter((l) => l.includes("REJECTED")).length}`);

  if (result.status !== "completed") {
    console.error(`\n❌ FAIL: Expected workflow to complete, got: ${result.status}`);
    process.exit(1);
  }

  if (gateEvals.filter((l) => l.includes("LLM evaluating")).length === 0) {
    console.error(`\n❌ FAIL: No gates were evaluated via LLM`);
    process.exit(1);
  }

  console.log(`\n✓ PASS: Workflow completed successfully with LLM-based gate evaluation`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
