import { describe, it, expect } from "vitest";
import {
  formatAuditResult,
  formatAuditResults,
  computeExitCode,
} from "../../src/auditor/formatter.js";
import type { AuditRunResult } from "../../src/auditor/auditor.js";

function makeResult(overrides: Partial<AuditRunResult> = {}): AuditRunResult {
  return {
    taskId: "audit-dsl-completeness",
    auditType: "render",
    data: {
      total_dimensions: 19,
      pass_count: 17,
      miss_count: 2,
      partial_count: 0,
      critical_gaps: [
        { dimension: "constraints", agent: "implementer", gap_type: "template_gap", severity: "critical" },
      ],
      recommendations: [
        { priority: "P0", description: "Add constraint rendering", fix_type: "template_fix" },
      ],
    },
    raw: "",
    prompt: "",
    dryRun: false,
    status: "success",
    followUpsUsed: 0,
    retriesUsed: 0,
    ...overrides,
  };
}

describe("formatAuditResult", () => {
  it("formats text output", () => {
    const text = formatAuditResult(makeResult(), "text");
    expect(text).toContain("Audit: render");
    expect(text).toContain("Status: success");
    expect(text).toContain("PASS: 17");
    expect(text).toContain("MISS: 2");
    expect(text).toContain("Critical Gaps:");
    expect(text).toContain("constraints");
    expect(text).toContain("Recommendations:");
    expect(text).toContain("Add constraint rendering");
  });

  it("formats json output", () => {
    const json = formatAuditResult(makeResult(), "json");
    const parsed = JSON.parse(json);
    expect(parsed.audit_type).toBe("render");
    expect(parsed.status).toBe("success");
    expect(parsed.data.total_dimensions).toBe(19);
    expect(parsed.data.critical_gaps).toHaveLength(1);
  });

  it("formats markdown output", () => {
    const md = formatAuditResult(makeResult(), "markdown");
    expect(md).toContain("## Audit: render");
    expect(md).toContain("| Total dimensions | 19 |");
    expect(md).toContain("### Critical Gaps");
    expect(md).toContain("### Recommendations");
  });

  it("handles error status", () => {
    const text = formatAuditResult(makeResult({ status: "error", errorMessage: "boom", data: null }), "text");
    expect(text).toContain("Status: error");
    expect(text).toContain("Error: boom");
  });
});

describe("formatAuditResults", () => {
  it("formats multiple results as json array", () => {
    const json = formatAuditResults([makeResult(), makeResult({ auditType: "dsl" })], "json");
    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].audit_type).toBe("render");
    expect(parsed[1].audit_type).toBe("dsl");
  });
});

describe("computeExitCode", () => {
  it("returns 0 for no critical findings", () => {
    const r = makeResult({ data: { total_dimensions: 19, pass_count: 19, miss_count: 0 } });
    expect(computeExitCode([r])).toBe(0);
  });

  it("returns 1 for critical findings", () => {
    expect(computeExitCode([makeResult()])).toBe(1);
  });

  it("returns 2 for error status", () => {
    expect(computeExitCode([makeResult({ status: "error", errorMessage: "bad input" })])).toBe(2);
  });

  it("returns 3 for runtime not installed", () => {
    expect(computeExitCode([makeResult({ status: "error", errorMessage: "not installed" })])).toBe(3);
  });
});
