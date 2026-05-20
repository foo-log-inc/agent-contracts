import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { parse as parseYaml } from "yaml";
import { describe, it, expect } from "vitest";
import { validateSchema } from "../../src/validator/schema-validator.js";
import { checkReferences } from "../../src/validator/reference-resolver.js";
import { validateHandoffSchemas } from "../../src/validator/handoff-schema-validator.js";
import { DslSchema } from "../../src/schema/index.js";

const fixturesDir = resolve(import.meta.dirname, "../fixtures");

function loadFixture(rel: string): Record<string, unknown> {
  return parseYaml(readFileSync(join(fixturesDir, rel), "utf8")) as Record<string, unknown>;
}

describe("validateSchema", () => {
  it("succeeds on valid minimal fixture", () => {
    const data = loadFixture("minimal/agent-contracts.yaml");
    const result = validateSchema(data);
    expect(result.success).toBe(true);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("succeeds on valid full fixture", () => {
    const data = loadFixture("full/agent-contracts.yaml");
    const result = validateSchema(data);
    expect(result.success).toBe(true);
  });

  it("returns diagnostics for invalid schema", () => {
    const data = loadFixture("invalid/missing-required.yaml");
    const result = validateSchema(data);
    expect(result.success).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0].code).toBe("schema-validation");
  });

  it("passes x- prefix properties through", () => {
    const data = loadFixture("full/agent-contracts.yaml");
    const result = validateSchema(data);
    expect(result.success).toBe(true);
    if (result.data) {
      const arch = result.data.agents["main-architect"];
      expect((arch as Record<string, unknown>)["x-identity"]).toBeDefined();
    }
  });

  it("rejects non-x- custom properties", () => {
    const data = {
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: [] },
      agents: {
        a: { role_name: "R", purpose: "P", custom_field: "bad" },
      },
    };
    const result = validateSchema(data);
    expect(result.success).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "unknown-property")).toBe(true);
    expect(result.diagnostics.some((d) => d.message.includes("custom_field"))).toBe(true);
  });

  it("allows x- properties in nested workflow steps", () => {
    const data = {
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: [] },
      workflow: {
        phase1: {
          steps: [
            { type: "handoff", handoff_kind: "k", "x-description": "desc" },
          ],
        },
      },
    };
    const result = validateSchema(data);
    expect(result.success).toBe(true);
  });

  it("rejects non-x- custom properties in nested workflow steps", () => {
    const data = {
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: [] },
      workflow: {
        phase1: {
          steps: [
            { type: "handoff", handoff_kind: "k", bad_prop: true },
          ],
        },
      },
    };
    const result = validateSchema(data);
    expect(result.success).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "unknown-property")).toBe(true);
    expect(result.diagnostics.some((d) => d.message.includes("bad_prop"))).toBe(true);
  });

  it("allows x- properties in nested agent rules", () => {
    const data = {
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: [] },
      agents: {
        a: {
          role_name: "R",
          purpose: "P",
          rules: [
            { id: "r1", description: "d", severity: "mandatory", "x-rule-meta": "ok" },
          ],
        },
      },
    };
    const result = validateSchema(data);
    expect(result.success).toBe(true);
  });

  it("rejects non-x- custom properties in nested agent rules", () => {
    const data = {
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: [] },
      agents: {
        a: {
          role_name: "R",
          purpose: "P",
          rules: [
            { id: "r1", description: "d", severity: "mandatory", bad_field: true },
          ],
        },
      },
    };
    const result = validateSchema(data);
    expect(result.success).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "unknown-property")).toBe(true);
    expect(result.diagnostics.some((d) => d.message.includes("bad_field"))).toBe(true);
  });

  it("rejects non-x- custom properties in nested execution steps", () => {
    const data = {
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: [] },
      tasks: {
        t1: {
          description: "d",
          target_agent: "a",
          allowed_from_agents: ["a"],
          workflow: "p",
          input_artifacts: [],
          invocation_handoff: "h",
          result_handoff: "r",
          execution_steps: [
            { id: "s1", action: "act", typo_field: 1 },
          ],
        },
      },
    };
    const result = validateSchema(data);
    expect(result.success).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "unknown-property")).toBe(true);
    expect(result.diagnostics.some((d) => d.message.includes("typo_field"))).toBe(true);
  });
});

describe("checkReferences", () => {
  it("returns no reference-not-found diagnostics for full fixture", () => {
    const data = loadFixture("full/agent-contracts.yaml");
    const parsed = DslSchema.parse(data);
    const diagnostics = checkReferences(parsed);
    const refErrors = diagnostics.filter((d) => d.code === "reference-not-found");
    expect(refErrors).toHaveLength(0);
  });

  it("detects non-existent agent reference in artifact.owner", () => {
    const dsl = DslSchema.parse({
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: ["implement"] },
      agents: { a1: { role_name: "R", purpose: "P" } },
      artifacts: {
        art1: {
          type: "code",
          owner: "nonexistent",
          producers: ["a1"],
          editors: ["a1"],
          consumers: ["a1"],
          states: ["draft"],
        },
      },
    });
    const diagnostics = checkReferences(dsl);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some((d) => d.message.includes("nonexistent"))).toBe(true);
  });

  it("detects non-existent tool in agent.can_execute_tools", () => {
    const dsl = DslSchema.parse({
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: [] },
      agents: {
        a1: { role_name: "R", purpose: "P", can_execute_tools: ["missing-tool"] },
      },
    });
    const diagnostics = checkReferences(dsl);
    expect(diagnostics.some((d) => d.message.includes("missing-tool"))).toBe(true);
  });

  it("detects non-existent tool in tool.extends", () => {
    const dsl = DslSchema.parse({
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: [] },
      tools: {
        child: { extends: "missing-base", command: "lint" },
      },
    });
    const diagnostics = checkReferences(dsl);
    expect(
      diagnostics.some(
        (d) =>
          d.code === "tool-extends-not-found" &&
          d.path === "tools.child.extends" &&
          d.message.includes("missing-base"),
      ),
    ).toBe(true);
  });

  it("detects non-existent agent in task.target_agent", () => {
    const dsl = DslSchema.parse({
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: ["impl"] },
      agents: { a1: { role_name: "R", purpose: "P" } },
      tasks: {
        t1: {
          description: "d",
          target_agent: "nonexistent",
          allowed_from_agents: ["a1"],
          workflow: "impl",
          input_artifacts: [],
          invocation_handoff: "h",
          result_handoff: "r",
        },
      },
      handoff_types: {
        h: { version: 1, schema: {} },
        r: { version: 1, schema: {} },
      },
    });
    const diagnostics = checkReferences(dsl);
    expect(diagnostics.some((d) => d.message.includes("nonexistent"))).toBe(true);
  });

  it("detects non-existent task in delegate workflow step", () => {
    const dsl = DslSchema.parse({
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: ["impl"] },
      agents: { a1: { role_name: "R", purpose: "P" } },
      workflow: {
        impl: {
          steps: [
            { type: "delegate", task: "missing-task", from_agent: "a1" },
          ],
        },
      },
    });
    const diagnostics = checkReferences(dsl);
    expect(diagnostics.some((d) => d.message.includes("missing-task"))).toBe(true);
  });

  it("detects non-existent agent in delegate workflow step", () => {
    const dsl = DslSchema.parse({
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: ["impl"] },
      agents: { a1: { role_name: "R", purpose: "P" } },
      workflow: {
        impl: {
          steps: [
            { type: "delegate", task: "t1", from_agent: "missing-agent" },
          ],
        },
      },
    });
    const diagnostics = checkReferences(dsl);
    expect(diagnostics.some((d) => d.message.includes("missing-agent"))).toBe(true);
  });

  it("detects non-existent handoff_type in gate workflow step", () => {
    const dsl = DslSchema.parse({
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: ["impl"] },
      workflow: {
        impl: {
          steps: [
            { type: "gate", gate_kind: "missing-gate" },
          ],
        },
      },
    });
    const diagnostics = checkReferences(dsl);
    expect(diagnostics.some((d) => d.message.includes("missing-gate"))).toBe(true);
  });

  it("detects non-existent validation in task.validations", () => {
    const dsl = DslSchema.parse({
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: ["impl"] },
      agents: { a1: { role_name: "R", purpose: "P" } },
      tasks: {
        t1: {
          description: "d",
          target_agent: "a1",
          allowed_from_agents: ["a1"],
          workflow: "impl",
          input_artifacts: [],
          invocation_handoff: "h",
          result_handoff: "r",
          validations: ["missing-val"],
        },
      },
      handoff_types: {
        h: { version: 1, schema: {} },
        r: { version: 1, schema: {} },
      },
    });
    const diagnostics = checkReferences(dsl);
    expect(diagnostics.some((d) => d.message.includes("missing-val"))).toBe(true);
  });

  it("detects non-existent validation in workflow step", () => {
    const dsl = DslSchema.parse({
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: ["impl"] },
      workflow: {
        impl: {
          steps: [
            { type: "validation", validation: "missing-val" },
          ],
        },
      },
    });
    const diagnostics = checkReferences(dsl);
    expect(diagnostics.some((d) => d.message.includes("missing-val"))).toBe(true);
  });

  it("detects artifact owner without read permission (artifact-owner-no-read)", () => {
    const dsl = DslSchema.parse({
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: ["p"] },
      agents: { owner: { role_name: "R", purpose: "P", can_read_artifacts: [] } },
      artifacts: {
        art1: {
          type: "code",
          owner: "owner",
          producers: ["owner"],
          editors: ["owner"],
          consumers: ["owner"],
          states: ["draft"],
        },
      },
    });
    const diagnostics = checkReferences(dsl);
    expect(diagnostics.some((d) => d.code === "artifact-owner-no-read")).toBe(true);
    expect(diagnostics.some((d) => d.message.includes("cannot read"))).toBe(true);
  });

  it("allows artifact owner with read permission (no artifact-owner-no-read)", () => {
    const dsl = DslSchema.parse({
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: ["p"] },
      agents: { owner: { role_name: "R", purpose: "P", can_read_artifacts: ["art1"] } },
      artifacts: {
        art1: {
          type: "code",
          owner: "owner",
          producers: ["owner"],
          editors: ["owner"],
          consumers: ["owner"],
          states: ["draft"],
        },
      },
    });
    const diagnostics = checkReferences(dsl);
    expect(diagnostics.filter((d) => d.code === "artifact-owner-no-read")).toHaveLength(0);
  });

  it("detects tool validation executor with empty invokable_by (validation-executor-unreachable)", () => {
    const dsl = DslSchema.parse({
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: ["p"] },
      agents: { a1: { role_name: "R", purpose: "P", can_read_artifacts: ["art1"] } },
      artifacts: {
        art1: {
          type: "code",
          owner: "a1",
          producers: ["a1"],
          editors: ["a1"],
          consumers: ["a1"],
          states: ["draft"],
          required_validations: ["v1"],
        },
      },
      tools: { tool1: { kind: "lint", invokable_by: [] } },
      validations: {
        v1: {
          target_artifact: "art1",
          kind: "schema",
          executor_type: "tool",
          executor: "tool1",
          blocking: false,
        },
      },
    });
    const diagnostics = checkReferences(dsl);
    expect(diagnostics.some((d) => d.code === "validation-executor-unreachable")).toBe(true);
    expect(diagnostics.some((d) => d.message.includes("invokable_by"))).toBe(true);
  });

  it("detects result_handoff not in target agent can_return_handoffs (result-handoff-not-returnable)", () => {
    const dsl = DslSchema.parse({
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: ["p"] },
      agents: {
        a1: { role_name: "R", purpose: "P", can_return_handoffs: ["inv"] },
      },
      tasks: {
        t1: {
          description: "d",
          target_agent: "a1",
          allowed_from_agents: ["a1"],
          workflow: "p",
          input_artifacts: [],
          invocation_handoff: "inv",
          result_handoff: "res",
        },
      },
      handoff_types: {
        inv: { version: 1, schema: {} },
        res: { version: 1, schema: {} },
      },
    });
    const diagnostics = checkReferences(dsl);
    expect(diagnostics.some((d) => d.code === "result-handoff-not-returnable")).toBe(true);
    expect(diagnostics.some((d) => d.message.includes("can_return_handoffs"))).toBe(true);
  });

  it("detects input_artifact not in target agent can_read_artifacts (input-artifact-not-readable)", () => {
    const dsl = DslSchema.parse({
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: ["p"] },
      agents: {
        a1: { role_name: "R", purpose: "P", can_read_artifacts: ["art1"], can_return_handoffs: ["inv", "res"] },
        a2: { role_name: "R", purpose: "P", can_read_artifacts: ["art2"] },
      },
      artifacts: {
        art1: { type: "code", owner: "a1", producers: ["a1"], editors: ["a1"], consumers: ["a1"], states: ["draft"] },
        art2: { type: "code", owner: "a2", producers: ["a2"], editors: ["a2"], consumers: ["a2"], states: ["draft"] },
      },
      tasks: {
        t1: {
          description: "d",
          target_agent: "a1",
          allowed_from_agents: ["a1"],
          workflow: "p",
          input_artifacts: ["art2"],
          invocation_handoff: "inv",
          result_handoff: "res",
        },
      },
      handoff_types: {
        inv: { version: 1, schema: {} },
        res: { version: 1, schema: {} },
      },
    });
    const diagnostics = checkReferences(dsl);
    expect(diagnostics.some((d) => d.code === "input-artifact-not-readable")).toBe(true);
    expect(diagnostics.some((d) => d.message.includes("can_read_artifacts"))).toBe(true);
  });

  it("detects read-only agent with non-empty can_write_artifacts (readonly-agent-has-writes)", () => {
    const dsl = DslSchema.parse({
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: ["p"] },
      agents: {
        a1: { role_name: "R", purpose: "P", mode: "read-only", can_read_artifacts: ["art1"], can_write_artifacts: ["art1"] },
      },
      artifacts: {
        art1: { type: "code", owner: "a1", producers: ["a1"], editors: ["a1"], consumers: ["a1"], states: ["draft"] },
      },
    });
    const diagnostics = checkReferences(dsl);
    expect(diagnostics.some((d) => d.code === "readonly-agent-has-writes")).toBe(true);
    expect(diagnostics.some((d) => d.message.includes("read-only"))).toBe(true);
  });

  it("detects prerequisite target not in can_read_artifacts (prerequisite-not-readable)", () => {
    const dsl = DslSchema.parse({
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: ["p"] },
      agents: {
        a1: { role_name: "R", purpose: "P", can_read_artifacts: [], prerequisites: [{ action: "read", target: "art1", required: true }] },
        a2: { role_name: "R", purpose: "P", can_read_artifacts: ["art1"] },
      },
      artifacts: {
        art1: { type: "code", owner: "a2", producers: ["a2"], editors: ["a2"], consumers: ["a2"], states: ["draft"] },
      },
    });
    const diagnostics = checkReferences(dsl);
    expect(diagnostics.some((d) => d.code === "prerequisite-not-readable")).toBe(true);
    expect(diagnostics.some((d) => d.message.includes("Prerequisite target"))).toBe(true);
  });

  it("detects schema required field missing from properties (schema-required-not-in-properties)", () => {
    const dsl = DslSchema.parse({
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: [] },
      handoff_types: {
        h: {
          version: 1,
          schema: {
            required: ["missingKey"],
            properties: { other: { type: "string" } },
          },
        },
      },
    });
    const diagnostics = checkReferences(dsl);
    expect(diagnostics.some((d) => d.code === "schema-required-not-in-properties")).toBe(true);
    expect(diagnostics.some((d) => d.message.includes("missingKey"))).toBe(true);
  });

  it("detects schema property with empty enum (schema-empty-enum)", () => {
    const dsl = DslSchema.parse({
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: [] },
      handoff_types: {
        h: {
          version: 1,
          schema: {
            properties: {
              status: { type: "string", enum: [] },
            },
          },
        },
      },
    });
    const diagnostics = checkReferences(dsl);
    expect(diagnostics.some((d) => d.code === "schema-empty-enum")).toBe(true);
    expect(diagnostics.some((d) => d.message.includes("empty enum"))).toBe(true);
  });

  it("returns no diagnostics when all new integrity rules are satisfied", () => {
    const dsl = DslSchema.parse({
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: ["p"] },
      agents: {
        a1: { role_name: "R", purpose: "P", can_read_artifacts: ["art1"], can_return_handoffs: ["inv", "res"], prerequisites: [{ action: "read", target: "art1", required: true }] },
      },
      artifacts: {
        art1: { type: "code", owner: "a1", producers: ["a1"], editors: ["a1"], consumers: ["a1"], states: ["draft"], required_validations: ["v1"] },
      },
      tools: { tool1: { kind: "lint", invokable_by: ["a1"] } },
      validations: {
        v1: { target_artifact: "art1", kind: "schema", executor_type: "tool", executor: "tool1", blocking: false },
      },
      tasks: {
        t1: { description: "d", target_agent: "a1", allowed_from_agents: ["a1"], workflow: "p", input_artifacts: ["art1"], invocation_handoff: "inv", result_handoff: "res" },
      },
      handoff_types: {
        inv: { version: 1, schema: { required: ["taskId"], properties: { taskId: { type: "string" } } } },
        res: { version: 1, schema: { properties: { outcome: { type: "string", enum: ["ok", "fail"] } } } },
      },
    });
    const diagnostics = checkReferences(dsl);
    expect(diagnostics).toHaveLength(0);
  });
});

describe("validateHandoffSchemas", () => {
  it("passes for valid JSON Schema in handoff_types", () => {
    const dsl = DslSchema.parse({
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: [] },
      handoff_types: {
        h: {
          version: 1,
          schema: {
            type: "object",
            required: ["a"],
            properties: { a: { type: "string" } },
          },
        },
      },
    });
    const diagnostics = validateHandoffSchemas(dsl);
    expect(diagnostics).toHaveLength(0);
  });

  it("passes for empty schema", () => {
    const dsl = DslSchema.parse({
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: [] },
      handoff_types: { h: { version: 1, schema: {} } },
    });
    const diagnostics = validateHandoffSchemas(dsl);
    expect(diagnostics).toHaveLength(0);
  });

  it("detects invalid JSON Schema", () => {
    const dsl = DslSchema.parse({
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: [] },
      handoff_types: {
        h: {
          version: 1,
          schema: { type: "not-a-valid-type" },
        },
      },
    });
    const diagnostics = validateHandoffSchemas(dsl);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0].code).toBe("invalid-handoff-schema");
  });

  it("passes for schema with allOf", () => {
    const dsl = DslSchema.parse({
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: [] },
      handoff_types: {
        h: {
          version: 1,
          schema: {
            allOf: [
              { type: "object", properties: { a: { type: "string" } } },
              { type: "object", properties: { b: { type: "number" } } },
            ],
          },
        },
      },
    });
    const diagnostics = validateHandoffSchemas(dsl);
    expect(diagnostics).toHaveLength(0);
  });
});

describe("checkReferences — guardrail scope and policy references", () => {
  it("detects non-existent agent in guardrail scope", () => {
    const dsl = DslSchema.parse({
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: [] },
      guardrails: {
        g1: { description: "d", scope: { agents: ["missing-agent"] }, tags: [] },
      },
    });
    const diagnostics = checkReferences(dsl);
    expect(diagnostics.some((d) => d.code === "guardrail-scope-ref-not-found")).toBe(true);
    expect(diagnostics.some((d) => d.message.includes("missing-agent"))).toBe(true);
  });

  it("detects non-existent task in guardrail scope", () => {
    const dsl = DslSchema.parse({
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: [] },
      guardrails: {
        g1: { description: "d", scope: { tasks: ["missing-task"] }, tags: [] },
      },
    });
    const diagnostics = checkReferences(dsl);
    expect(diagnostics.some((d) => d.code === "guardrail-scope-ref-not-found")).toBe(true);
    expect(diagnostics.some((d) => d.message.includes("missing-task"))).toBe(true);
  });

  it("detects non-existent tool in guardrail scope", () => {
    const dsl = DslSchema.parse({
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: [] },
      guardrails: {
        g1: { description: "d", scope: { tools: ["missing-tool"] }, tags: [] },
      },
    });
    const diagnostics = checkReferences(dsl);
    expect(diagnostics.some((d) => d.code === "guardrail-scope-ref-not-found")).toBe(true);
    expect(diagnostics.some((d) => d.message.includes("missing-tool"))).toBe(true);
  });

  it("detects non-existent artifact in guardrail scope", () => {
    const dsl = DslSchema.parse({
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: [] },
      guardrails: {
        g1: { description: "d", scope: { artifacts: ["missing-artifact"] }, tags: [] },
      },
    });
    const diagnostics = checkReferences(dsl);
    expect(diagnostics.some((d) => d.code === "guardrail-scope-ref-not-found")).toBe(true);
    expect(diagnostics.some((d) => d.message.includes("missing-artifact"))).toBe(true);
  });

  it("detects non-existent workflow in guardrail scope", () => {
    const dsl = DslSchema.parse({
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: ["implement"] },
      guardrails: {
        g1: { description: "d", scope: { workflows: ["not-in-default-order"] }, tags: [] },
      },
    });
    const diagnostics = checkReferences(dsl);
    expect(diagnostics.some((d) => d.code === "guardrail-scope-ref-not-found")).toBe(true);
    expect(diagnostics.some((d) => d.message.includes("not-in-default-order"))).toBe(true);
  });

  it("detects guardrail policy rule referencing non-existent guardrail", () => {
    const dsl = DslSchema.parse({
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: [] },
      guardrail_policies: {
        p1: {
          rules: [{ guardrail: "no-such-guardrail", severity: "info", action: "info" }],
        },
      },
    });
    const diagnostics = checkReferences(dsl);
    expect(diagnostics.some((d) => d.code === "guardrail-policy-ref-not-found")).toBe(true);
    expect(diagnostics.some((d) => d.message.includes("no-such-guardrail"))).toBe(true);
  });

  it("returns no guardrail diagnostics when all references are valid", () => {
    const dsl = DslSchema.parse({
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: ["w1"] },
      agents: {
        a1: {
          role_name: "R",
          purpose: "P",
          can_read_artifacts: ["art1"],
          can_write_artifacts: [],
          can_execute_tools: ["tool1"],
          can_perform_validations: [],
          can_invoke_agents: [],
          can_return_handoffs: ["h1", "h2"],
        },
      },
      artifacts: {
        art1: {
          type: "code",
          owner: "a1",
          producers: ["a1"],
          editors: ["a1"],
          consumers: ["a1"],
          states: ["draft"],
        },
      },
      tools: {
        tool1: {
          kind: "lint",
          invokable_by: ["a1"],
          input_artifacts: [],
          output_artifacts: [],
          side_effects: [],
        },
      },
      tasks: {
        t1: {
          description: "d",
          target_agent: "a1",
          allowed_from_agents: ["a1"],
          workflow: "w1",
          input_artifacts: ["art1"],
          invocation_handoff: "h1",
          result_handoff: "h2",
        },
      },
      handoff_types: {
        h1: { version: 1, schema: {} },
        h2: { version: 1, schema: {} },
      },
      workflow: {
        w1: { steps: [] },
      },
      guardrails: {
        gr1: {
          description: "Coherent scope",
          scope: {
            agents: ["a1"],
            tasks: ["t1"],
            tools: ["tool1"],
            artifacts: ["art1"],
            workflows: ["w1"],
          },
          tags: [],
        },
      },
      guardrail_policies: {
        pol1: {
          rules: [{ guardrail: "gr1", severity: "critical", action: "block" }],
        },
      },
    });
    const diagnostics = checkReferences(dsl);
    const grDiags = diagnostics.filter(
      (d) =>
        d.code === "guardrail-scope-ref-not-found" || d.code === "guardrail-policy-ref-not-found",
    );
    expect(grDiags).toHaveLength(0);
  });
});

describe("validateSchema — decision step routing_key", () => {
  it("accepts decision step with routing_key", () => {
    const data = {
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: ["impl"] },
      workflow: {
        impl: {
          steps: [
            { type: "decision", routing_key: "field.verdict", branches: { PASS: ["a"] } },
          ],
        },
      },
    };
    const result = validateSchema(data);
    expect(result.success).toBe(true);
  });

  it("accepts decision step with deprecated on", () => {
    const data = {
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: ["impl"] },
      workflow: {
        impl: {
          steps: [
            { type: "decision", on: "field.verdict", branches: { PASS: ["a"] } },
          ],
        },
      },
    };
    const result = validateSchema(data);
    expect(result.success).toBe(true);
  });

  it("rejects decision step with neither on nor routing_key", () => {
    const data = {
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: ["impl"] },
      workflow: {
        impl: {
          steps: [
            { type: "decision", branches: { PASS: ["a"] } },
          ],
        },
      },
    };
    const result = validateSchema(data);
    expect(result.success).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "decision-missing-routing-key")).toBe(true);
  });
});

function minimalDsl(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    system: { id: "s", name: "S", default_workflow_order: [] },
    agents: {
      a1: { role_name: "R", purpose: "P" },
    },
    tasks: {
      t1: {
        description: "d",
        target_agent: "a1",
        allowed_from_agents: ["a1"],
        workflow: "w",
        input_artifacts: [],
        invocation_handoff: "h1",
        result_handoff: "h2",
      },
    },
    handoff_types: {
      h1: { version: 1, schema: {} },
      h2: { version: 1, schema: {} },
    },
    workflow: { w: { steps: [] } },
    ...overrides,
  };
}

describe("validateSchema — extension validation", () => {
  it("emits extension-scope-mismatch when extension scope is Agent but used on Task", () => {
    const data = minimalDsl({
      "extensions": {
        "x-only-agent": { type: "string", scope: ["agent"] },
      },
      tasks: {
        t1: {
          description: "d",
          target_agent: "a1",
          allowed_from_agents: ["a1"],
          workflow: "w",
          input_artifacts: [],
          invocation_handoff: "h1",
          result_handoff: "h2",
          "x-only-agent": "nope",
        },
      },
    });
    const result = validateSchema(data);
    expect(result.success).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "extension-scope-mismatch")).toBe(true);
  });

  it("emits extension-scope-mismatch for x-* on WorkflowStep when scope excludes it", () => {
    const data = minimalDsl({
      "extensions": {
        "x-agent-only": { type: "string", scope: ["agent"] },
      },
      workflow: {
        w: {
          steps: [{ type: "handoff", handoff_kind: "k", "x-agent-only": "wrong" }],
        },
      },
    });
    const result = validateSchema(data);
    expect(result.success).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "extension-scope-mismatch")).toBe(true);
  });

  it("allows extension with scope Agent on Agent node", () => {
    const data = minimalDsl({
      "extensions": {
        "x-only-agent": { type: "string", scope: ["agent"] },
      },
      agents: {
        a1: { role_name: "R", purpose: "P", "x-only-agent": "ok" },
      },
    });
    const result = validateSchema(data);
    expect(result.success).toBe(true);
    expect(result.diagnostics.filter((d) => d.code === "extension-scope-mismatch")).toHaveLength(0);
  });

  it("emits extension-schema-violation when value breaks declared JSON Schema", () => {
    const data = minimalDsl({
      "extensions": {
        "x-label": { type: "string", schema: { type: "string", minLength: 1 } },
      },
      agents: {
        a1: { role_name: "R", purpose: "P", "x-label": "" },
      },
    });
    const result = validateSchema(data);
    expect(result.success).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "extension-schema-violation")).toBe(true);
  });

  it("emits extension-schema-violation when declaration has invalid JSON Schema", () => {
    const data = minimalDsl({
      "extensions": {
        "x-bad": { type: "string", schema: { type: "invalid-type" } },
      },
      agents: {
        a1: { role_name: "R", purpose: "P", "x-bad": "anything" },
      },
    });
    const result = validateSchema(data);
    expect(result.success).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "extension-schema-violation")).toBe(true);
  });

  it("passes when extension value conforms to declared schema", () => {
    const data = minimalDsl({
      "extensions": {
        "x-label": { type: "string", schema: { type: "string", minLength: 1 } },
      },
      agents: {
        a1: { role_name: "R", purpose: "P", "x-label": "ok" },
      },
    });
    const result = validateSchema(data);
    expect(result.success).toBe(true);
  });

  it("emits extension-required-missing when required Artifact-scoped extension is absent", () => {
    const data = minimalDsl({
      artifacts: {
        art1: {
          type: "code",
          owner: "a1",
          producers: ["a1"],
          editors: ["a1"],
          consumers: ["a1"],
          states: ["draft"],
        },
      },
      "extensions": {
        "x-art-meta": { type: "string", required: true, scope: ["artifact"] },
      },
    });
    const result = validateSchema(data);
    expect(result.success).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "extension-required-missing")).toBe(true);
  });

  it("passes when required Artifact-scoped extension is present on all artifacts", () => {
    const data = minimalDsl({
      artifacts: {
        art1: {
          type: "code",
          owner: "a1",
          producers: ["a1"],
          editors: ["a1"],
          consumers: ["a1"],
          states: ["draft"],
          "x-art-meta": "m1",
        },
        art2: {
          type: "code",
          owner: "a1",
          producers: ["a1"],
          editors: ["a1"],
          consumers: ["a1"],
          states: ["draft"],
          "x-art-meta": "m2",
        },
      },
      "extensions": {
        "x-art-meta": { type: "string", required: true, scope: ["artifact"] },
      },
    });
    const result = validateSchema(data);
    expect(result.success).toBe(true);
    expect(result.diagnostics.filter((d) => d.code === "extension-required-missing")).toHaveLength(0);
  });

  it("warns with undeclared-extension for x-* key not listed in extensions", () => {
    const data = minimalDsl({
      agents: {
        a1: { role_name: "R", purpose: "P", "x-mystery": true },
      },
      "extensions": {
        "x-known": { type: "string" },
      },
    });
    const result = validateSchema(data);
    expect(result.success).toBe(true);
    expect(result.diagnostics.some((d) => d.code === "undeclared-extension")).toBe(true);
    expect(result.diagnostics.find((d) => d.code === "undeclared-extension")?.severity).toBe("warning");
  });

  it("does not set success false when only undeclared-extension warnings exist", () => {
    const data = minimalDsl({
      agents: {
        a1: { role_name: "R", purpose: "P", "x-not-listed": "v" },
      },
      "extensions": {
        "x-other": { type: "string" },
      },
    });
    const result = validateSchema(data);
    expect(result.success).toBe(true);
    expect(result.diagnostics.some((d) => d.code === "undeclared-extension")).toBe(true);
  });

  it("accepts extension declaration entries with only type, items, and description", () => {
    const data = minimalDsl({
      "extensions": {
        "x-flags": { type: "array", items: "string", description: "flags" },
      },
    });
    const result = validateSchema(data);
    expect(result.success).toBe(true);
    expect(result.diagnostics.filter((d) => d.code.startsWith("extension-"))).toHaveLength(0);
  });

  it("skips extension validation when extensions declarations are absent even if x-* properties exist", () => {
    const data = minimalDsl({
      agents: {
        a1: { role_name: "R", purpose: "P", "x-freeform": "yes" },
      },
    });
    const result = validateSchema(data);
    expect(result.success).toBe(true);
    expect(
      result.diagnostics.filter(
        (d) =>
          d.code === "undeclared-extension" ||
          d.code === "extension-scope-mismatch" ||
          d.code === "extension-schema-violation" ||
          d.code === "extension-required-missing",
      ),
    ).toHaveLength(0);
  });
});

describe("validateSchema — extensions_strict mode", () => {
  it("promotes undeclared-extension from warning to error when extensions_strict is true", () => {
    const data = minimalDsl({
      "extensions": { "x-known": { type: "string" } },
      "extensions_strict": true,
      agents: {
        a1: { role_name: "R", purpose: "P", "x-unknown": "val" },
      },
    });
    const result = validateSchema(data);
    expect(result.success).toBe(false);
    const diag = result.diagnostics.find((d) => d.code === "undeclared-extension");
    expect(diag).toBeDefined();
    expect(diag!.severity).toBeUndefined();
  });

  it("keeps undeclared-extension as warning when extensions_strict is false", () => {
    const data = minimalDsl({
      "extensions": { "x-known": { type: "string" } },
      "extensions_strict": false,
      agents: {
        a1: { role_name: "R", purpose: "P", "x-unknown": "val" },
      },
    });
    const result = validateSchema(data);
    expect(result.success).toBe(true);
    expect(
      result.diagnostics.some(
        (d) => d.code === "undeclared-extension" && d.severity === "warning",
      ),
    ).toBe(true);
  });

  it("reports all x-* as undeclared errors when strict but no extensions declared", () => {
    const data = minimalDsl({
      "extensions_strict": true,
      agents: {
        a1: { role_name: "R", purpose: "P", "x-anything": "val" },
      },
    });
    const result = validateSchema(data);
    expect(result.success).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "undeclared-extension")).toBe(true);
  });

  it("passes strict mode when all x-* properties are declared", () => {
    const data = minimalDsl({
      "extensions": { "x-tag": { type: "string" } },
      "extensions_strict": true,
      agents: {
        a1: { role_name: "R", purpose: "P", "x-tag": "ok" },
      },
    });
    const result = validateSchema(data);
    expect(result.success).toBe(true);
    expect(result.diagnostics.filter((d) => d.code === "undeclared-extension")).toHaveLength(0);
  });
});

describe("validateSchema — extensions key validation", () => {
  it("accepts extensions with x- prefixed keys", () => {
    const data = {
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: [] },
      "extensions": {
        "x-flags": { type: "array", items: "string", description: "CLI flags" },
        "x-check-script": { type: "string", description: "Hook check script path" },
      },
    };
    const result = validateSchema(data);
    expect(result.success).toBe(true);
  });

  it("rejects extensions with non-x- prefixed keys", () => {
    const data = {
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: [] },
      "extensions": {
        "flags": { type: "array", description: "bad key" },
      },
    };
    const result = validateSchema(data);
    expect(result.success).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "x-extension-key-prefix")).toBe(true);
  });

  it("accepts DSL without extensions", () => {
    const data = {
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: [] },
    };
    const result = validateSchema(data);
    expect(result.success).toBe(true);
  });
});

describe("validateSchema — deprecated x-extensions aliases", () => {
  it("accepts x-extensions and emits deprecated-property warning", () => {
    const data = {
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: [] },
      "x-extensions": {
        "x-flags": { type: "array", items: "string", description: "flags" },
      },
    };
    const result = validateSchema(data);
    expect(result.success).toBe(true);
    expect(
      result.diagnostics.some(
        (d) =>
          d.code === "deprecated-property" &&
          d.path === "x-extensions" &&
          d.severity === "warning",
      ),
    ).toBe(true);
    expect(result.data?.extensions).toEqual({
      "x-flags": {
        type: "array",
        items: "string",
        description: "flags",
        required: false,
      },
    });
  });

  it("accepts x-extensions-strict alias with deprecated-property warning", () => {
    const data = minimalDsl({
      extensions: { "x-known": { type: "string" } },
      "x-extensions-strict": true,
      agents: {
        a1: { role_name: "R", purpose: "P", "x-known": "ok" },
      },
    });
    const result = validateSchema(data);
    expect(result.success).toBe(true);
    expect(
      result.diagnostics.some(
        (d) =>
          d.code === "deprecated-property" &&
          d.path === "x-extensions-strict" &&
          d.severity === "warning",
      ),
    ).toBe(true);
  });

  it("does not copy x-extensions when extensions is already set", () => {
    const data = {
      version: 1,
      system: { id: "s", name: "S", default_workflow_order: [] },
      extensions: {
        "x-from-new": { type: "string", description: "new" },
      },
      "x-extensions": {
        "x-from-old": { type: "string", description: "old" },
      },
    };
    const result = validateSchema(data);
    expect(result.success).toBe(true);
    expect(
      result.diagnostics.filter((d) => d.code === "deprecated-property"),
    ).toHaveLength(0);
    expect(result.data?.extensions).toEqual({
      "x-from-new": { type: "string", description: "new", required: false },
    });
  });
});
