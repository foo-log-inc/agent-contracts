import { describe, it, expect } from "vitest";
import {
  toYamlString,
  toJsonString,
  toYamlFrontmatter,
} from "../../src/renderer/serialization.js";
import {
  resolveHandoffPayload,
  buildHandoffEnvelope,
} from "../../src/renderer/handoff-payload.js";

describe("serialization", () => {
  it("toYamlString renders nested objects", () => {
    expect(toYamlString({ task_id: "specify", nested: { a: 1 } })).toBe(
      'task_id: "specify"\nnested: a: 1',
    );
  });

  it("toJsonString pretty-prints JSON", () => {
    expect(toJsonString({ a: 1, b: ["x"] })).toBe(
      '{\n  "a": 1,\n  "b": [\n    "x"\n  ]\n}',
    );
  });

  it("toYamlFrontmatter wraps content with delimiters", () => {
    expect(toYamlFrontmatter({ type: "task-delegation", version: 1 })).toBe(
      '---\ntype: "task-delegation"\nversion: 1\n---\n',
    );
  });

  it("toYamlFrontmatter handles empty object", () => {
    expect(toYamlFrontmatter({})).toBe("---\n---\n");
  });
});

describe("handoff payload resolution", () => {
  it("prefers example over schema skeleton", () => {
    const payload = resolveHandoffPayload({
      schema: {
        type: "object",
        required: ["task_id"],
        properties: { task_id: { type: "string" } },
      },
      example: { task_id: "from-example" },
    });
    expect(payload).toEqual({ task_id: "from-example" });
  });

  it("generates skeleton from schema required fields", () => {
    const payload = resolveHandoffPayload({
      schema: {
        type: "object",
        required: ["task_id", "validation_result"],
        properties: {
          task_id: { type: "string" },
          validation_result: { type: "string", enum: ["pass", "fail"] },
          notes: { type: "string" },
        },
      },
    });
    expect(payload).toEqual({
      task_id: "<task_id>",
      validation_result: "pass",
    });
  });

  it("resolves allOf composed schemas", () => {
    const payload = resolveHandoffPayload({
      schema: {
        allOf: [
          {
            type: "object",
            required: ["from_agent"],
            properties: { from_agent: { type: "string" } },
          },
          {
            type: "object",
            required: ["objective"],
            properties: { objective: { type: "string" } },
          },
        ],
      },
    });
    expect(payload).toEqual({
      from_agent: "<from_agent>",
      objective: "<objective>",
    });
  });

  it("buildHandoffEnvelope wraps payload with type and version", () => {
    const envelope = buildHandoffEnvelope(
      {
        id: "dsl-task-request",
        version: 1,
        schema: {
          type: "object",
          required: ["task_id"],
          properties: { task_id: { type: "string" } },
        },
      },
    );
    expect(envelope).toEqual({
      type: "dsl-task-request",
      version: 1,
      payload: { task_id: "<task_id>" },
    });
  });

  it("buildHandoffEnvelope accepts id override for record iteration", () => {
    const envelope = buildHandoffEnvelope(
      {
        version: 2,
        example: { ok: true },
      },
      "custom-id",
    );
    expect(envelope).toEqual({
      type: "custom-id",
      version: 2,
      payload: { ok: true },
    });
  });
});
