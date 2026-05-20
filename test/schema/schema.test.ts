import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";
import {
  AgentSchema,
  AppendOperatorSchema,
  ArtifactSchema,
  DslSchema,
  EscalationCriterionSchema,
  ExecutionStepSchema,
  HandoffTypeSchema,
  InsertAfterOperatorSchema,
  PolicySchema,
  PrerequisiteSchema,
  PrependOperatorSchema,
  RemoveOperatorSchema,
  ReplaceOperatorSchema,
  RuleSchema,
  SystemSchema,
  TaskSchema,
  TeamImportSchema,
  TeamInterfaceSchema,
  ToolSchema,
  ValidationSchema,
  WorkflowSchema,
  WorkflowStepSchema,
  resolveAllOf,
  ContextTypeSchema,
  ITERABLE_CONTEXT_TYPES,
} from "../../src/schema/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const fixturesDir = join(__dirname, "../fixtures");

function loadYaml(relativePath: string): unknown {
  const full = join(fixturesDir, relativePath);
  return parseYaml(readFileSync(full, "utf8"));
}

const minimalValidSystem = {
  id: "sys",
  name: "System",
  default_workflow_order: ["a", "b"],
};

const minimalValidAgent = {
  role_name: "Role",
  purpose: "Purpose",
};

const minimalValidTask = {
  description: "Do work",
  target_agent: "agent-1",
  allowed_from_agents: ["agent-1"],
  workflow: "implement",
  input_artifacts: ["art-1"],
  invocation_handoff: "h-in",
  result_handoff: "h-out",
};

const minimalValidArtifact = {
  type: "code",
  owner: "agent-1",
  producers: ["agent-1"],
  editors: ["agent-1"],
  consumers: ["agent-1"],
  states: ["draft"],
};

const minimalValidTool = {
  kind: "cli",
  invokable_by: ["agent-1"],
};

const minimalValidValidation = {
  target_artifact: "art-1",
  kind: "schema" as const,
  executor_type: "tool" as const,
  executor: "tool-1",
  blocking: true,
};

const minimalValidHandoffType = {
  version: 1,
  schema: { type: "object" },
};

const minimalValidWorkflow = {
  steps: [
    {
      type: "handoff" as const,
      handoff_kind: "task-delegation",
    },
    {
      type: "validation" as const,
      validation: "val-1",
    },
    {
      type: "decision" as const,
      on: "some.field",
      branches: { PASS: ["next"], BLOCK: ["stop"] },
    },
  ],
};

const minimalValidPolicy = {
  when: { workflow: "implement" },
};

describe("schema normal cases", () => {
  it("parses SystemSchema", () => {
    expect(() => SystemSchema.parse(minimalValidSystem)).not.toThrow();
  });

  it("parses AgentSchema", () => {
    const a = AgentSchema.parse(minimalValidAgent);
    expect(a.can_read_artifacts).toEqual([]);
  });

  it("parses TaskSchema", () => {
    expect(() => TaskSchema.parse(minimalValidTask)).not.toThrow();
  });

  it("defaults TaskSchema validations to []", () => {
    const t = TaskSchema.parse(minimalValidTask);
    expect(t.validations).toEqual([]);
  });

  it("parses TaskSchema with validations", () => {
    const t = TaskSchema.parse({ ...minimalValidTask, validations: ["v1", "v2"] });
    expect(t.validations).toEqual(["v1", "v2"]);
  });

  it("parses ArtifactSchema", () => {
    const a = ArtifactSchema.parse(minimalValidArtifact);
    expect(a.required_validations).toEqual([]);
  });

  it("parses ToolSchema", () => {
    const t = ToolSchema.parse(minimalValidTool);
    expect(t.input_artifacts).toEqual([]);
  });

  it("parses ValidationSchema for each kind enum", () => {
    const kinds = ["schema", "mechanical", "semantic", "approval", "provenance", "traceability", "fidelity"] as const;
    for (const kind of kinds) {
      expect(() =>
        ValidationSchema.parse({ ...minimalValidValidation, kind }),
      ).not.toThrow();
    }
  });

  it("parses HandoffTypeSchema", () => {
    expect(() => HandoffTypeSchema.parse(minimalValidHandoffType)).not.toThrow();
  });

  it("parses WorkflowSchema with handoff, validation, and decision steps", () => {
    expect(() => WorkflowSchema.parse(minimalValidWorkflow)).not.toThrow();
  });

  it("parses PolicySchema", () => {
    expect(() => PolicySchema.parse(minimalValidPolicy)).not.toThrow();
  });
});

describe("boundary values", () => {
  it("accepts empty strings on required string fields where applicable", () => {
    expect(() =>
      SystemSchema.parse({
        id: "",
        name: "",
        default_workflow_order: [],
      }),
    ).not.toThrow();
    const agent = AgentSchema.parse({
      role_name: "",
      purpose: "",
    });
    expect(agent.role_name).toBe("");
  });

  it("accepts empty arrays on list fields (task, artifact, tool)", () => {
    expect(() =>
      TaskSchema.parse({
        ...minimalValidTask,
        allowed_from_agents: [],
        input_artifacts: [],
      }),
    ).not.toThrow();
    expect(() =>
      ArtifactSchema.parse({
        ...minimalValidArtifact,
        producers: [],
        editors: [],
        consumers: [],
        states: [],
      }),
    ).not.toThrow();
    expect(() =>
      ToolSchema.parse({
        ...minimalValidTool,
        invokable_by: [],
      }),
    ).not.toThrow();
  });

  it("accepts explicit empty permission arrays on AgentSchema", () => {
    const a = AgentSchema.parse({
      ...minimalValidAgent,
      can_read_artifacts: [],
      can_write_artifacts: [],
      can_execute_tools: [],
      can_perform_validations: [],
      can_invoke_agents: [],
      can_return_handoffs: [],
    });
    expect(a.can_read_artifacts).toEqual([]);
    expect(a.can_write_artifacts).toEqual([]);
  });

  it("parses AgentSchema with optional dispatch_only, mode, and prerequisites", () => {
    const a = AgentSchema.parse({
      ...minimalValidAgent,
      dispatch_only: true,
      mode: "read-write",
      prerequisites: [
        { action: "read", target: "art-1", required: false },
        { action: "execute", target: "tool-1", required: true },
      ],
    });
    expect(a.dispatch_only).toBe(true);
    expect(a.mode).toBe("read-write");
    expect(a.prerequisites).toHaveLength(2);
  });

  it("omits optional agent fields when absent", () => {
    const a = AgentSchema.parse(minimalValidAgent);
    expect(a.dispatch_only).toBeUndefined();
    expect(a.mode).toBeUndefined();
    expect(a.prerequisites).toBeUndefined();
  });
});

describe("schema default values", () => {
  it("defaults all AgentSchema permission arrays to [] when omitted", () => {
    const a = AgentSchema.parse(minimalValidAgent);
    expect(a.can_read_artifacts).toEqual([]);
    expect(a.can_write_artifacts).toEqual([]);
    expect(a.can_execute_tools).toEqual([]);
    expect(a.can_perform_validations).toEqual([]);
    expect(a.can_invoke_agents).toEqual([]);
    expect(a.can_return_handoffs).toEqual([]);
  });

  it("defaults ToolSchema input_artifacts, output_artifacts, and side_effects to []", () => {
    const t = ToolSchema.parse(minimalValidTool);
    expect(t.input_artifacts).toEqual([]);
    expect(t.output_artifacts).toEqual([]);
    expect(t.side_effects).toEqual([]);
  });

  it("accepts extends and command fields on ToolSchema", () => {
    const t = ToolSchema.parse({
      extends: "speckeeper-base",
      command: "lint",
    });
    expect(t.extends).toBe("speckeeper-base");
    expect(t.command).toBe("lint");
  });

  it("accepts ToolSchema without kind", () => {
    const t = ToolSchema.parse({
      extends: "speckeeper-base",
      command: "lint",
    });
    expect(t.kind).toBeUndefined();
  });

  it("defaults WorkflowSchema entry_conditions to [] when omitted", () => {
    const w = WorkflowSchema.parse({
      steps: [
        { type: "handoff" as const, handoff_kind: "task-delegation" },
      ],
    });
    expect(w.entry_conditions).toEqual([]);
  });

  it("defaults DslSchema collection fields when omitted", () => {
    const d = DslSchema.parse({
      version: 1,
      system: minimalValidSystem,
    });
    expect(d.agents).toEqual({});
    expect(d.tasks).toEqual({});
    expect(d.artifacts).toEqual({});
    expect(d.tools).toEqual({});
    expect(d.validations).toEqual({});
    expect(d.handoff_types).toEqual({});
    expect(d.workflow).toEqual({});
    expect(d.policies).toEqual({});
    expect(d.guardrails).toEqual({});
    expect(d.guardrail_policies).toEqual({});
  });
});

describe("WorkflowStepSchema discriminated union", () => {
  it("parses handoff step", () => {
    const s = WorkflowStepSchema.parse({
      type: "handoff",
      handoff_kind: "task-delegation",
    });
    expect(s.type).toBe("handoff");
    if (s.type === "handoff") {
      expect(s.handoff_kind).toBe("task-delegation");
    }
  });

  it("parses validation step", () => {
    const s = WorkflowStepSchema.parse({
      type: "validation",
      validation: "val-1",
    });
    expect(s.type).toBe("validation");
    if (s.type === "validation") {
      expect(s.validation).toBe("val-1");
    }
  });

  it("parses decision step with on (deprecated)", () => {
    const s = WorkflowStepSchema.parse({
      type: "decision",
      on: "field.path",
      branches: { A: ["s1"], B: [] },
    });
    expect(s.type).toBe("decision");
    if (s.type === "decision") {
      expect(s.on).toBe("field.path");
      expect(s.branches.B).toEqual([]);
    }
  });

  it("parses decision step with routing_key", () => {
    const s = WorkflowStepSchema.parse({
      type: "decision",
      routing_key: "field.path",
      branches: { A: ["s1"], B: [] },
    });
    expect(s.type).toBe("decision");
    if (s.type === "decision") {
      expect(s.routing_key).toBe("field.path");
      expect(s.branches.B).toEqual([]);
    }
  });

  it("parses decision step with both on and routing_key", () => {
    const s = WorkflowStepSchema.parse({
      type: "decision",
      on: "legacy.path",
      routing_key: "field.path",
      branches: { A: ["s1"] },
    });
    expect(s.type).toBe("decision");
    if (s.type === "decision") {
      expect(s.routing_key).toBe("field.path");
      expect(s.on).toBe("legacy.path");
    }
  });

  it("parses delegate step", () => {
    const s = WorkflowStepSchema.parse({
      type: "delegate",
      task: "implement-feature",
      from_agent: "architect",
    });
    expect(s.type).toBe("delegate");
    if (s.type === "delegate") {
      expect(s.task).toBe("implement-feature");
      expect(s.from_agent).toBe("architect");
    }
  });

  it("parses delegate step with retry and group", () => {
    const s = WorkflowStepSchema.parse({
      type: "delegate",
      task: "implement-feature",
      from_agent: "architect",
      group: "impl-group",
      retry: { condition: "Lint fails", fix_task: "fix-lint" },
    });
    expect(s.type).toBe("delegate");
    if (s.type === "delegate") {
      expect(s.group).toBe("impl-group");
      expect(s.retry).toBeDefined();
    }
  });

  it("parses gate step", () => {
    const s = WorkflowStepSchema.parse({
      type: "gate",
      gate_kind: "evidence-gate",
    });
    expect(s.type).toBe("gate");
    if (s.type === "gate") {
      expect(s.gate_kind).toBe("evidence-gate");
    }
  });

  it("parses gate step with group", () => {
    const s = WorkflowStepSchema.parse({
      type: "gate",
      gate_kind: "evidence-gate",
      group: "review-group",
    });
    expect(s.type).toBe("gate");
    if (s.type === "gate") {
      expect(s.group).toBe("review-group");
    }
  });

  it("passes through unknown keys on handoff step (validated by schema-validator)", () => {
    const r = WorkflowStepSchema.safeParse({
      type: "handoff",
      handoff_kind: "k",
      extra: 1,
    });
    expect(r.success).toBe(true);
  });

  it("parses team_task step", () => {
    const s = WorkflowStepSchema.parse({
      type: "team_task",
      to_team: "backend",
      workflow: "implement",
      handoff: "feature-request",
      expects: "implementation-result",
    });
    expect(s.type).toBe("team_task");
    if (s.type === "team_task") {
      expect(s.to_team).toBe("backend");
      expect(s.workflow).toBe("implement");
    }
  });

  it("parses team_task step with description and group", () => {
    const s = WorkflowStepSchema.parse({
      type: "team_task",
      to_team: "backend",
      workflow: "implement",
      handoff: "feature-request",
      expects: "implementation-result",
      description: "Delegate to backend",
      group: "cross-team",
    });
    expect(s.type).toBe("team_task");
    if (s.type === "team_task") {
      expect(s.description).toBe("Delegate to backend");
      expect(s.group).toBe("cross-team");
    }
  });

  it("allows x- properties on team_task step", () => {
    const s = WorkflowStepSchema.parse({
      type: "team_task",
      to_team: "backend",
      workflow: "implement",
      handoff: "h1",
      expects: "h2",
      "x-meta": true,
    });
    expect((s as Record<string, unknown>)["x-meta"]).toBe(true);
  });
});

describe("schema error cases", () => {
  it("rejects AgentSchema without role_name", () => {
    const r = AgentSchema.safeParse({
      purpose: "p",
    });
    expect(r.success).toBe(false);
  });

  it("rejects AgentSchema without purpose", () => {
    const r = AgentSchema.safeParse({
      role_name: "r",
    });
    expect(r.success).toBe(false);
  });

  it("rejects TaskSchema when required fields are missing", () => {
    const r = TaskSchema.safeParse({
      target_agent: "a",
      allowed_from_agents: [],
      workflow: "p",
      input_artifacts: [],
      invocation_handoff: "i",
      result_handoff: "r",
    });
    expect(r.success).toBe(false);
  });

  it("rejects ValidationSchema with invalid kind", () => {
    const r = ValidationSchema.safeParse({
      ...minimalValidValidation,
      kind: "unknown",
    });
    expect(r.success).toBe(false);
  });

  it("rejects WorkflowSchema when step type is invalid", () => {
    const r = WorkflowSchema.safeParse({
      steps: [{ type: "not-a-step" }],
    });
    expect(r.success).toBe(false);
  });
});

describe("x- prefix passthrough on passthrough schemas", () => {
  it("allows x-identity on AgentSchema", () => {
    const a = AgentSchema.parse({
      ...minimalValidAgent,
      "x-identity": "extra",
    });
    expect((a as Record<string, unknown>)["x-identity"]).toBe("extra");
  });

  it("allows x-custom on TaskSchema", () => {
    const t = TaskSchema.parse({
      ...minimalValidTask,
      "x-custom": { n: 1 },
    });
    expect((t as Record<string, unknown>)["x-custom"]).toEqual({ n: 1 });
  });

  it("allows x- properties on ArtifactSchema", () => {
    const x = ArtifactSchema.parse({
      ...minimalValidArtifact,
      "x-artifact-meta": true,
    });
    expect((x as Record<string, unknown>)["x-artifact-meta"]).toBe(true);
  });

  it("allows x- properties on ToolSchema", () => {
    const x = ToolSchema.parse({
      ...minimalValidTool,
      "x-rate-limit": "low",
    });
    expect((x as Record<string, unknown>)["x-rate-limit"]).toBe("low");
  });

  it("allows x- properties on ValidationSchema", () => {
    const x = ValidationSchema.parse({
      ...minimalValidValidation,
      "x-validation-meta": { depth: "full" },
    });
    expect((x as Record<string, unknown>)["x-validation-meta"]).toEqual({
      depth: "full",
    });
  });

  it("allows x- properties on HandoffTypeSchema", () => {
    const x = HandoffTypeSchema.parse({
      ...minimalValidHandoffType,
      "x-handoff-meta": { stable: true },
    });
    expect((x as Record<string, unknown>)["x-handoff-meta"]).toEqual({
      stable: true,
    });
  });

  it("allows x- properties on WorkflowSchema", () => {
    const x = WorkflowSchema.parse({
      ...minimalValidWorkflow,
      "x-workflow-meta": { fixture: true },
    });
    expect((x as Record<string, unknown>)["x-workflow-meta"]).toEqual({
      fixture: true,
    });
  });

  it("allows x- properties on PolicySchema", () => {
    const x = PolicySchema.parse({
      ...minimalValidPolicy,
      "x-policy-meta": { severity: "high" },
    });
    expect((x as Record<string, unknown>)["x-policy-meta"]).toEqual({
      severity: "high",
    });
  });

  it("allows x- properties on SystemSchema", () => {
    const s = SystemSchema.parse({
      ...minimalValidSystem,
      "x-system-meta": { tier: "fixture" },
    });
    expect((s as Record<string, unknown>)["x-system-meta"]).toEqual({
      tier: "fixture",
    });
  });
});

describe("nested schemas allow x- properties via passthrough", () => {
  it("allows x- properties on WorkflowStepSchema (handoff)", () => {
    const s = WorkflowStepSchema.parse({
      type: "handoff",
      handoff_kind: "task-delegation",
      "x-description": "Delegate to sub-agent",
    });
    expect((s as Record<string, unknown>)["x-description"]).toBe("Delegate to sub-agent");
  });

  it("allows x- properties on WorkflowStepSchema (validation)", () => {
    const s = WorkflowStepSchema.parse({
      type: "validation",
      validation: "val-1",
      "x-timeout": 30,
    });
    expect((s as Record<string, unknown>)["x-timeout"]).toBe(30);
  });

  it("allows x- properties on WorkflowStepSchema (decision)", () => {
    const s = WorkflowStepSchema.parse({
      type: "decision",
      on: "field.path",
      branches: { A: ["s1"] },
      "x-meta": { info: true },
    });
    expect((s as Record<string, unknown>)["x-meta"]).toEqual({ info: true });
  });

  it("allows x- properties on RuleSchema", () => {
    const r = RuleSchema.parse({
      id: "R",
      description: "d",
      severity: "mandatory",
      "x-rule-meta": "extra",
    });
    expect((r as Record<string, unknown>)["x-rule-meta"]).toBe("extra");
  });

  it("allows x- properties on ExecutionStepSchema", () => {
    const s = ExecutionStepSchema.parse({
      id: "s",
      action: "act",
      "x-step-info": 42,
    });
    expect((s as Record<string, unknown>)["x-step-info"]).toBe(42);
  });

  it("allows x- properties on EscalationCriterionSchema", () => {
    const e = EscalationCriterionSchema.parse({
      condition: "c",
      action: "stop_and_report",
      "x-escalation-meta": true,
    });
    expect((e as Record<string, unknown>)["x-escalation-meta"]).toBe(true);
  });

  it("allows x- properties on PrerequisiteSchema", () => {
    const p = PrerequisiteSchema.parse({
      action: "read",
      target: "t",
      required: true,
      "x-prereq-note": "important",
    });
    expect((p as Record<string, unknown>)["x-prereq-note"]).toBe("important");
  });
});

describe("merge operator schemas", () => {
  it("parses AppendOperatorSchema", () => {
    expect(AppendOperatorSchema.parse({ $append: { a: 1, b: 2 } })).toEqual({
      $append: { a: 1, b: 2 },
    });
  });

  it("parses AppendOperatorSchema with empty entries", () => {
    expect(AppendOperatorSchema.parse({ $append: {} })).toEqual({
      $append: {},
    });
  });

  it("parses PrependOperatorSchema", () => {
    expect(PrependOperatorSchema.parse({ $prepend: { a: "x" } })).toEqual({
      $prepend: { a: "x" },
    });
  });

  it("parses PrependOperatorSchema with empty entries", () => {
    expect(PrependOperatorSchema.parse({ $prepend: {} })).toEqual({
      $prepend: {},
    });
  });

  it("parses InsertAfterOperatorSchema", () => {
    expect(
      InsertAfterOperatorSchema.parse({
        $insert_after: { after: "x", entries: { y: 1 } },
      }),
    ).toEqual({ $insert_after: { after: "x", entries: { y: 1 } } });
  });

  it("parses InsertAfterOperatorSchema with empty entries", () => {
    expect(
      InsertAfterOperatorSchema.parse({
        $insert_after: { after: "x", entries: {} },
      }),
    ).toEqual({ $insert_after: { after: "x", entries: {} } });
  });

  it("parses ReplaceOperatorSchema", () => {
    expect(ReplaceOperatorSchema.parse({ $replace: null })).toEqual({
      $replace: null,
    });
  });

  it("parses RemoveOperatorSchema", () => {
    expect(
      RemoveOperatorSchema.parse({ $remove: ["a"] }),
    ).toEqual({ $remove: ["a"] });
  });

  it("parses RemoveOperatorSchema with empty remove list", () => {
    expect(RemoveOperatorSchema.parse({ $remove: [] })).toEqual({
      $remove: [],
    });
  });
});

describe("DslSchema with fixture YAMLs", () => {
  it("parses minimal fixture", () => {
    const data = loadYaml("minimal/agent-contracts.yaml");
    const r = DslSchema.safeParse(data);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.version).toBe(1);
      expect(r.data.system.id).toBe("minimal-system");
    }
  });

  it("parses full fixture including x- properties", () => {
    const data = loadYaml("full/agent-contracts.yaml");
    const r = DslSchema.safeParse(data);
    expect(r.success).toBe(true);
    if (r.success) {
      const arch = r.data.agents["main-architect"];
      expect(arch).toBeDefined();
      expect(
        (arch as Record<string, unknown> | undefined)?.["x-identity"],
      ).toBeDefined();
      expect(r.data.extends).toBe("@agent-contracts/base-team");
    }
  });

  it("rejects invalid fixtures with parse errors", () => {
    const invalidDir = join(fixturesDir, "invalid");
    const skipFiles = new Set(["bad-yaml-syntax.yaml"]);
    const files = readdirSync(invalidDir).filter(
      (f) => f.endsWith(".yaml") && !skipFiles.has(f),
    );
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const data = loadYaml(join("invalid", file));
      const r = DslSchema.safeParse(data);
      expect(r.success, `expected ${file} to fail validation`).toBe(false);
    }
  });

  it("invalid-enum fixture fails on validation kind", () => {
    const data = loadYaml("invalid/invalid-enum.yaml");
    const r = DslSchema.safeParse(data);
    expect(r.success).toBe(false);
    if (!r.success) {
      const paths = r.error.issues.map((i) => i.path.join("."));
      expect(paths.some((p) => p.includes("kind"))).toBe(true);
    }
  });

  it("missing-required fixture fails on agent fields", () => {
    const data = loadYaml("invalid/missing-required.yaml");
    const r = DslSchema.safeParse(data);
    expect(r.success).toBe(false);
    if (!r.success) {
      const paths = r.error.issues.map((i) => i.path.join("."));
      expect(
        paths.some(
          (p) =>
            p.includes("role_name") ||
            p.includes("purpose") ||
            p.includes("agents"),
        ),
      ).toBe(true);
    }
  });

  it("missing-version fixture fails", () => {
    const data = loadYaml("invalid/missing-version.yaml");
    const r = DslSchema.safeParse(data);
    expect(r.success).toBe(false);
    if (!r.success) {
      const paths = r.error.issues.map((i) => i.path.join("."));
      expect(paths.some((p) => p === "version" || p.endsWith(".version"))).toBe(
        true,
      );
    }
  });

  it("bad-type fixture fails (version must be number literal 1)", () => {
    const data = loadYaml("invalid/bad-type.yaml");
    const r = DslSchema.safeParse(data);
    expect(r.success).toBe(false);
    if (!r.success) {
      const paths = r.error.issues.map((i) => i.path.join("."));
      expect(paths.some((p) => p === "version" || p.endsWith(".version"))).toBe(
        true,
      );
    }
  });
});

describe("new standard properties", () => {
  it("parses ExecutionStepSchema with optional description", () => {
    const s = ExecutionStepSchema.parse({
      id: "step-1",
      action: "Do something",
      description: "Detailed explanation of step",
    });
    expect(s.description).toBe("Detailed explanation of step");
  });

  it("omits ExecutionStepSchema description when absent", () => {
    const s = ExecutionStepSchema.parse({ id: "s", action: "a" });
    expect(s.description).toBeUndefined();
  });

  it("parses WorkflowStepSchema (handoff) with description", () => {
    const s = WorkflowStepSchema.parse({
      type: "handoff",
      handoff_kind: "task-delegation",
      description: "Delegate to sub-agent",
    });
    expect(s.type).toBe("handoff");
    if (s.type === "handoff") {
      expect(s.description).toBe("Delegate to sub-agent");
    }
  });

  it("parses WorkflowStepSchema (validation) with description", () => {
    const s = WorkflowStepSchema.parse({
      type: "validation",
      validation: "val-1",
      description: "Run lint checks",
    });
    expect(s.type).toBe("validation");
    if (s.type === "validation") {
      expect(s.description).toBe("Run lint checks");
    }
  });

  it("parses WorkflowStepSchema (decision) with description", () => {
    const s = WorkflowStepSchema.parse({
      type: "decision",
      on: "status",
      branches: { pass: ["next"] },
      description: "Route based on status",
    });
    expect(s.type).toBe("decision");
    if (s.type === "decision") {
      expect(s.description).toBe("Route based on status");
    }
  });

  it("parses WorkflowSchema with optional trigger", () => {
    const w = WorkflowSchema.parse({
      steps: [{ type: "handoff" as const, handoff_kind: "k" }],
      trigger: "on_task_complete",
    });
    expect(w.trigger).toBe("on_task_complete");
  });

  it("omits WorkflowSchema trigger when absent", () => {
    const w = WorkflowSchema.parse({
      steps: [{ type: "handoff" as const, handoff_kind: "k" }],
    });
    expect(w.trigger).toBeUndefined();
  });

  it("parses HandoffTypeSchema with optional example", () => {
    const h = HandoffTypeSchema.parse({
      version: 1,
      schema: { type: "object" },
      example: { summary: "Fix login bug", status: "complete" },
    });
    expect(h.example).toEqual({ summary: "Fix login bug", status: "complete" });
  });

  it("omits HandoffTypeSchema example when absent", () => {
    const h = HandoffTypeSchema.parse(minimalValidHandoffType);
    expect(h.example).toBeUndefined();
  });
});

describe("TeamInterfaceSchema", () => {
  it("parses a full team_interface", () => {
    const ti = TeamInterfaceSchema.parse({
      version: 1,
      description: "Backend team interface",
      accepts: {
        workflows: {
          implement: {
            internal_workflow: "feature-implement",
            input_handoff: "feature-request",
            output_handoff: "implementation-result",
            description: "Request implementation",
          },
        },
      },
      exposes: { artifacts: ["api-contract"] },
      constraints: ["must include acceptance_criteria"],
    });
    expect(ti.version).toBe(1);
    expect(ti.accepts!.workflows.implement.input_handoff).toBe("feature-request");
    expect(ti.exposes!.artifacts).toEqual(["api-contract"]);
  });

  it("parses minimal team_interface (version only)", () => {
    const ti = TeamInterfaceSchema.parse({ version: 1 });
    expect(ti.version).toBe(1);
    expect(ti.accepts).toBeUndefined();
    expect(ti.exposes).toBeUndefined();
  });

  it("allows x- properties", () => {
    const ti = TeamInterfaceSchema.parse({ version: 1, "x-meta": true });
    expect((ti as Record<string, unknown>)["x-meta"]).toBe(true);
  });
});

describe("TeamImportSchema", () => {
  it("parses a full import entry", () => {
    const imp = TeamImportSchema.parse({
      interface: "./teams/backend/team-interface.yaml",
      version: ">=1",
    });
    expect(imp.interface).toBe("./teams/backend/team-interface.yaml");
    expect(imp.version).toBe(">=1");
  });

  it("parses import without version", () => {
    const imp = TeamImportSchema.parse({
      interface: "./backend-interface.yaml",
    });
    expect(imp.version).toBeUndefined();
  });

  it("allows x- properties", () => {
    const imp = TeamImportSchema.parse({
      interface: "./x.yaml",
      "x-source": "generated",
    });
    expect((imp as Record<string, unknown>)["x-source"]).toBe("generated");
  });
});

describe("DslSchema with team_interface and imports", () => {
  it("parses DSL with team_interface", () => {
    const d = DslSchema.parse({
      version: 1,
      system: minimalValidSystem,
      team_interface: {
        version: 1,
        accepts: {
          workflows: {
            implement: {
              input_handoff: "h-in",
              output_handoff: "h-out",
            },
          },
        },
      },
    });
    expect(d.team_interface).toBeDefined();
    expect(d.team_interface!.version).toBe(1);
  });

  it("parses DSL with imports", () => {
    const d = DslSchema.parse({
      version: 1,
      system: minimalValidSystem,
      imports: {
        backend: {
          interface: "./backend-interface.yaml",
          version: ">=1",
        },
      },
    });
    expect(d.imports).toBeDefined();
    expect(d.imports!.backend.interface).toBe("./backend-interface.yaml");
  });

  it("omits team_interface and imports when absent", () => {
    const d = DslSchema.parse({
      version: 1,
      system: minimalValidSystem,
    });
    expect(d.team_interface).toBeUndefined();
    expect(d.imports).toBeUndefined();
  });
});

describe("multi-team schema error cases", () => {
  it("rejects team_task step missing required to_team", () => {
    const r = WorkflowStepSchema.safeParse({
      type: "team_task",
      workflow: "implement",
      handoff: "h1",
      expects: "h2",
    });
    expect(r.success).toBe(false);
  });

  it("rejects team_task step missing required workflow", () => {
    const r = WorkflowStepSchema.safeParse({
      type: "team_task",
      to_team: "backend",
      handoff: "h1",
      expects: "h2",
    });
    expect(r.success).toBe(false);
  });

  it("rejects team_task step missing required handoff", () => {
    const r = WorkflowStepSchema.safeParse({
      type: "team_task",
      to_team: "backend",
      workflow: "implement",
      expects: "h2",
    });
    expect(r.success).toBe(false);
  });

  it("rejects team_task step missing required expects", () => {
    const r = WorkflowStepSchema.safeParse({
      type: "team_task",
      to_team: "backend",
      workflow: "implement",
      handoff: "h1",
    });
    expect(r.success).toBe(false);
  });

  it("rejects TeamInterfaceSchema without version", () => {
    const r = TeamInterfaceSchema.safeParse({
      description: "no version",
    });
    expect(r.success).toBe(false);
  });

  it("rejects TeamImportSchema without interface field", () => {
    const r = TeamImportSchema.safeParse({
      version: ">=1",
    });
    expect(r.success).toBe(false);
  });

  it("rejects TeamInterfaceSchema with non-number version", () => {
    const r = TeamInterfaceSchema.safeParse({
      version: "1",
    });
    expect(r.success).toBe(false);
  });
});

describe("generated JSON Schema (dsl.schema.json)", () => {
  it("exists and has expected top-level structure", () => {
    const schemaPath = join(__dirname, "../../schemas/dsl.schema.json");
    const raw = JSON.parse(readFileSync(schemaPath, "utf8")) as Record<
      string,
      unknown
    >;
    expect(raw.$schema).toBe(
      "https://json-schema.org/draft/2020-12/schema",
    );
    expect(raw.type).toBe("object");
    const props = raw.properties as Record<string, unknown>;
    expect(props).toHaveProperty("version");
    expect(props).toHaveProperty("system");
    expect(props).toHaveProperty("agents");
    expect(props).toHaveProperty("tasks");
    expect(props).toHaveProperty("artifacts");
    expect(props).toHaveProperty("tools");
    expect(props).toHaveProperty("validations");
    expect(props).toHaveProperty("handoff_types");
    expect(props).toHaveProperty("workflow");
    expect(props).toHaveProperty("policies");
    expect(props).toHaveProperty("guardrails");
    expect(props).toHaveProperty("guardrail_policies");
    expect(props).toHaveProperty("extensions");
    expect(props).toHaveProperty("extensions_strict");
    expect(props).toHaveProperty("team_interface");
    expect(props).toHaveProperty("imports");
    expect(raw.required).toEqual([
      "version",
      "system",
      "agents",
      "tasks",
      "artifacts",
      "tools",
      "validations",
      "handoff_types",
      "workflow",
      "policies",
      "guardrails",
      "guardrail_policies",
      "components",
      "extensions",
      "extensions_strict",
    ]);
  });

  it("parses DSL with components.schemas", () => {
    const dsl = DslSchema.parse({
      version: 1,
      system: minimalValidSystem,
      components: {
        schemas: {
          "handoff-common": {
            type: "object",
            properties: { from_agent: { type: "string" } },
          },
        },
      },
    });
    expect(dsl.components.schemas).toBeDefined();
    expect(dsl.components.schemas["handoff-common"]).toBeDefined();
  });

  it("defaults components to empty schemas", () => {
    const dsl = DslSchema.parse({
      version: 1,
      system: minimalValidSystem,
    });
    expect(dsl.components).toEqual({ schemas: {} });
  });
});

describe("resolveAllOf", () => {
  it("returns schema as-is when no allOf", () => {
    const schema = {
      type: "object",
      required: ["a"],
      properties: { a: { type: "string" } },
    };
    expect(resolveAllOf(schema)).toEqual(schema);
  });

  it("merges allOf sub-schemas", () => {
    const schema = {
      allOf: [
        {
          type: "object",
          required: ["from_agent"],
          properties: { from_agent: { type: "string" } },
        },
        {
          type: "object",
          required: ["payload"],
          properties: {
            payload: { type: "object", properties: { x: { type: "string" } } },
          },
        },
      ],
    };
    const result = resolveAllOf(schema);
    expect(result["type"]).toBe("object");
    expect(result["required"]).toEqual(
      expect.arrayContaining(["from_agent", "payload"]),
    );
    const props = result["properties"] as Record<string, unknown>;
    expect(props["from_agent"]).toEqual({ type: "string" });
    expect(props["payload"]).toBeDefined();
  });

  it("deduplicates required fields", () => {
    const schema = {
      allOf: [
        { required: ["a", "b"] },
        { required: ["b", "c"] },
      ],
    };
    const result = resolveAllOf(schema);
    expect(result["required"]).toEqual(["a", "b", "c"]);
  });

  it("merges inline properties alongside allOf", () => {
    const schema = {
      allOf: [
        { properties: { a: { type: "string" } } },
      ],
      properties: { b: { type: "number" } },
    };
    const result = resolveAllOf(schema);
    const props = result["properties"] as Record<string, unknown>;
    expect(props["a"]).toEqual({ type: "string" });
    expect(props["b"]).toEqual({ type: "number" });
  });
});

describe("ContextTypeSchema", () => {
  it("accepts navigation_index as a valid context type", () => {
    expect(ContextTypeSchema.parse("navigation_index")).toBe("navigation_index");
  });

  it("excludes navigation_index from iterable context types", () => {
    expect(ITERABLE_CONTEXT_TYPES).not.toContain("navigation_index");
    expect(ITERABLE_CONTEXT_TYPES).not.toContain("system");
  });
});
