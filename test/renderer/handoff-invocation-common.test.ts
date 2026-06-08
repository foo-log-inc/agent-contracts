/**
 * Tests for Feature #134 — handoff invocation-common structured fields.
 *
 * Covers:
 *  - HandoffTypeSchema accepts target_agent and workflow_phase
 *  - buildHandoffEnvelope renders $tags when target_agent is set
 *  - buildHandoffEnvelope renders $tags when workflow_phase is set
 *  - buildHandoffEnvelope renders $tags with both fields
 *  - buildHandoffEnvelope omits $tags when neither field is set (backward compat)
 *  - resolveHandoffPayload is unaffected by the new fields
 */
import { describe, it, expect } from "vitest";
import {
  buildHandoffEnvelope,
  resolveHandoffPayload,
} from "../../src/renderer/handoff-payload.js";
import { HandoffTypeSchema } from "../../src/schema/handoff-type.js";

// ── Schema validation ─────────────────────────────────────────────────────────

describe("HandoffTypeSchema — new invocation-common fields (Feature #134)", () => {
  it("accepts a handoff type without target_agent or workflow_phase (backward compat)", () => {
    const result = HandoffTypeSchema.safeParse({
      version: 1,
      schema: { type: "object", properties: {} },
    });
    expect(result.success).toBe(true);
  });

  it("accepts target_agent field", () => {
    const result = HandoffTypeSchema.safeParse({
      version: 1,
      schema: { type: "object", properties: {} },
      target_agent: "implementer",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.target_agent).toBe("implementer");
    }
  });

  it("accepts workflow_phase field", () => {
    const result = HandoffTypeSchema.safeParse({
      version: 1,
      schema: { type: "object", properties: {} },
      workflow_phase: "implementation",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.workflow_phase).toBe("implementation");
    }
  });

  it("accepts both target_agent and workflow_phase together", () => {
    const result = HandoffTypeSchema.safeParse({
      version: 1,
      schema: { type: "object", properties: {} },
      target_agent: "reviewer",
      workflow_phase: "review",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.target_agent).toBe("reviewer");
      expect(result.data.workflow_phase).toBe("review");
    }
  });
});

// ── buildHandoffEnvelope — $tags rendering ────────────────────────────────────

describe("buildHandoffEnvelope — $tags (Feature #134)", () => {
  it("does NOT include $tags when neither field is set (backward compat)", () => {
    const envelope = buildHandoffEnvelope({
      id: "my-handoff",
      version: 1,
      schema: {
        type: "object",
        required: ["task_id"],
        properties: { task_id: { type: "string" } },
      },
    });
    expect(envelope).not.toHaveProperty("$tags");
    expect(envelope.type).toBe("my-handoff");
    expect(envelope.version).toBe(1);
    expect(envelope.payload).toEqual({ task_id: "<task_id>" });
  });

  it("includes $tags.target_agent when target_agent is set", () => {
    const envelope = buildHandoffEnvelope({
      id: "task-request",
      version: 1,
      schema: { type: "object", properties: {} },
      target_agent: "implementer",
    });
    expect(envelope).toHaveProperty("$tags");
    expect((envelope["$tags"] as Record<string, unknown>)["target_agent"]).toBe("implementer");
    expect((envelope["$tags"] as Record<string, unknown>)["workflow_phase"]).toBeUndefined();
  });

  it("includes $tags.workflow_phase when workflow_phase is set", () => {
    const envelope = buildHandoffEnvelope({
      id: "review-request",
      version: 2,
      schema: { type: "object", properties: {} },
      workflow_phase: "code-review",
    });
    expect(envelope).toHaveProperty("$tags");
    expect((envelope["$tags"] as Record<string, unknown>)["workflow_phase"]).toBe("code-review");
    expect((envelope["$tags"] as Record<string, unknown>)["target_agent"]).toBeUndefined();
  });

  it("includes both tags when both fields are set", () => {
    const envelope = buildHandoffEnvelope({
      id: "full-handoff",
      version: 1,
      schema: { type: "object", properties: {} },
      target_agent: "architect",
      workflow_phase: "design",
    });
    const tags = envelope["$tags"] as Record<string, unknown>;
    expect(tags["target_agent"]).toBe("architect");
    expect(tags["workflow_phase"]).toBe("design");
  });

  it("preserves existing envelope fields alongside $tags", () => {
    const envelope = buildHandoffEnvelope(
      {
        version: 3,
        example: { result: "ok" },
        target_agent: "validator",
        workflow_phase: "validation",
      },
      "override-id",
    );
    expect(envelope.type).toBe("override-id");
    expect(envelope.version).toBe(3);
    expect(envelope.payload).toEqual({ result: "ok" });
    expect((envelope["$tags"] as Record<string, unknown>)["target_agent"]).toBe("validator");
    expect((envelope["$tags"] as Record<string, unknown>)["workflow_phase"]).toBe("validation");
  });

  it("does NOT include $tags when both fields are empty strings (falsy)", () => {
    // Empty strings are falsy in JS, so neither tag should appear
    const envelope = buildHandoffEnvelope({
      id: "no-tags",
      version: 1,
      schema: { type: "object", properties: {} },
      // Do not set target_agent or workflow_phase
    });
    expect(envelope).not.toHaveProperty("$tags");
  });
});

// ── resolveHandoffPayload — unaffected by new fields ─────────────────────────

describe("resolveHandoffPayload — unaffected by invocation-common fields", () => {
  it("still uses example when provided", () => {
    const payload = resolveHandoffPayload({
      schema: { type: "object", properties: { x: { type: "string" } } },
      example: { x: "value" },
      target_agent: "agent-a",
      workflow_phase: "phase-1",
    });
    expect(payload).toEqual({ x: "value" });
  });

  it("still generates skeleton from schema when no example", () => {
    const payload = resolveHandoffPayload({
      schema: {
        type: "object",
        required: ["task_id"],
        properties: { task_id: { type: "string" } },
      },
      target_agent: "agent-b",
    });
    expect(payload).toEqual({ task_id: "<task_id>" });
  });
});
