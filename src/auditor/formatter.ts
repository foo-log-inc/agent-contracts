/**
 * Format audit results for CLI output.
 */

import type { DslAuditResult } from "../generated/dsl-base/handoffs.js";
import type { AuditRunResult } from "./auditor.js";
import type { OutputFormat } from "./types.js";

function formatResultText(r: AuditRunResult): string {
  const lines: string[] = [];
  lines.push(`=== Audit: ${r.auditType} (task: ${r.taskId}) ===`);
  lines.push(`Status: ${r.status}`);

  if (r.errorMessage) {
    lines.push(`Error: ${r.errorMessage}`);
    return lines.join("\n");
  }

  if (!r.data) {
    lines.push("(No structured data returned)");
    return lines.join("\n");
  }

  const d = r.data;
  lines.push(`Dimensions: ${d.total_dimensions} (PASS: ${d.pass_count}, MISS: ${d.miss_count}, PARTIAL: ${d.partial_count ?? 0})`);

  if (d.critical_gaps && d.critical_gaps.length > 0) {
    lines.push("\nCritical Gaps:");
    for (const gap of d.critical_gaps) {
      lines.push(`  [${gap.severity ?? "?"}] ${gap.dimension ?? "?"} — ${gap.agent ?? "system"} (${gap.gap_type ?? "unknown"})`);
    }
  }

  if (d.recommendations && d.recommendations.length > 0) {
    lines.push("\nRecommendations:");
    for (const rec of d.recommendations) {
      lines.push(`  [${rec.priority ?? "?"}] ${rec.description ?? ""} (${rec.fix_type ?? "?"})`);
    }
  }

  lines.push(`\nFollow-ups used: ${r.followUpsUsed}, Retries used: ${r.retriesUsed}`);
  return lines.join("\n");
}

function formatResultJson(r: AuditRunResult): string {
  return JSON.stringify({
    audit_type: r.auditType,
    task_id: r.taskId,
    status: r.status,
    data: r.data,
    error: r.errorMessage,
    follow_ups_used: r.followUpsUsed,
    retries_used: r.retriesUsed,
  }, null, 2);
}

function formatResultMarkdown(r: AuditRunResult): string {
  const lines: string[] = [];
  lines.push(`## Audit: ${r.auditType}`);
  lines.push(`**Status:** ${r.status}  `);
  lines.push(`**Task:** ${r.taskId}  `);

  if (r.errorMessage) {
    lines.push(`\n**Error:** ${r.errorMessage}`);
    return lines.join("\n");
  }

  if (!r.data) {
    lines.push("\n*No structured data returned*");
    return lines.join("\n");
  }

  const d = r.data;
  lines.push(`\n| Metric | Count |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total dimensions | ${d.total_dimensions} |`);
  lines.push(`| PASS | ${d.pass_count} |`);
  lines.push(`| MISS | ${d.miss_count} |`);
  lines.push(`| PARTIAL | ${d.partial_count ?? 0} |`);

  if (d.critical_gaps && d.critical_gaps.length > 0) {
    lines.push(`\n### Critical Gaps\n`);
    lines.push(`| Severity | Dimension | Agent | Gap Type |`);
    lines.push(`|----------|-----------|-------|----------|`);
    for (const gap of d.critical_gaps) {
      lines.push(`| ${gap.severity ?? "?"} | ${gap.dimension ?? "?"} | ${gap.agent ?? "system"} | ${gap.gap_type ?? "?"} |`);
    }
  }

  if (d.recommendations && d.recommendations.length > 0) {
    lines.push(`\n### Recommendations\n`);
    lines.push(`| Priority | Description | Fix Type |`);
    lines.push(`|----------|-------------|----------|`);
    for (const rec of d.recommendations) {
      lines.push(`| ${rec.priority ?? "?"} | ${rec.description ?? ""} | ${rec.fix_type ?? "?"} |`);
    }
  }

  return lines.join("\n");
}

export function formatAuditResult(r: AuditRunResult, format: OutputFormat): string {
  switch (format) {
    case "json":
      return formatResultJson(r);
    case "markdown":
      return formatResultMarkdown(r);
    default:
      return formatResultText(r);
  }
}

export function formatAuditResults(results: AuditRunResult[], format: OutputFormat): string {
  if (format === "json") {
    return JSON.stringify(results.map((r) => ({
      audit_type: r.auditType,
      task_id: r.taskId,
      status: r.status,
      data: r.data,
      error: r.errorMessage,
      follow_ups_used: r.followUpsUsed,
      retries_used: r.retriesUsed,
    })), null, 2);
  }
  return results.map((r) => formatAuditResult(r, format)).join("\n\n");
}

export function computeExitCode(results: AuditRunResult[], failOn?: string): number {
  for (const r of results) {
    if (r.status === "error") {
      if (r.errorMessage?.includes("not installed")) return 11;
      if (r.errorMessage?.includes("adapter") || r.errorMessage?.includes("API")) return 12;
      return 1;
    }
  }

  const severityRank: Record<string, number> = { info: 0, warning: 1, error: 2, critical: 3 };
  const threshold = severityRank[failOn ?? "critical"] ?? 3;

  for (const r of results) {
    if (r.data?.critical_gaps) {
      for (const gap of r.data.critical_gaps) {
        const rank = severityRank[gap.severity ?? ""] ?? 0;
        if (rank >= threshold) return 10;
      }
    }
  }
  return 0;
}
