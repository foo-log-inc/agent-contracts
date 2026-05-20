import { describe, it, expect } from "vitest";
import { spectralLint } from "../../src/linter/spectral-lint.js";

function makeDsl(partial: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    system: { id: "s", name: "S", default_workflow_order: ["implement"] },
    agents: {},
    tasks: {},
    artifacts: {},
    tools: {},
    validations: {},
    handoff_types: {},
    workflow: {},
    policies: {},
    ...partial,
  };
}

describe("Spectral lint — reference integrity", () => {
  it("detects artifact owner referencing non-existent agent", async () => {
    const dsl = makeDsl({
      agents: {},
      artifacts: {
        "spec-md": {
          type: "document",
          owner: "ghost-agent",
          producers: [],
          editors: ["ghost-agent"],
          consumers: [],
          states: ["draft"],
          required_validations: [],
        },
      },
    });
    const diags = await spectralLint(dsl);
    const ownerRef = diags.filter((d) => d.ruleId === "artifact-owner-ref");
    expect(ownerRef.length).toBeGreaterThan(0);
    expect(ownerRef[0].message).toContain("ghost-agent");
  });

  it("detects agent can_invoke_agents referencing non-existent agent", async () => {
    const dsl = makeDsl({
      agents: {
        arch: {
          role_name: "Arch",
          purpose: "P",
          can_read_artifacts: [],
          can_write_artifacts: [],
          can_execute_tools: [],
          can_perform_validations: [],
          can_invoke_agents: ["nonexistent"],
          can_return_handoffs: [],
        },
      },
    });
    const diags = await spectralLint(dsl);
    const ref = diags.filter(
      (d) => d.ruleId === "agent-can-invoke-agents-ref",
    );
    expect(ref.length).toBe(1);
    expect(ref[0].message).toContain("nonexistent");
  });

  it("detects task referencing non-existent handoff_type", async () => {
    const dsl = makeDsl({
      agents: {
        impl: {
          role_name: "I",
          purpose: "P",
          can_read_artifacts: [],
          can_write_artifacts: [],
          can_execute_tools: [],
          can_perform_validations: [],
          can_invoke_agents: [],
          can_return_handoffs: [],
        },
      },
      tasks: {
        "do-work": {
          description: "d",
          target_agent: "impl",
          allowed_from_agents: ["impl"],
          workflow: "implement",
          input_artifacts: [],
          invocation_handoff: "ghost-handoff",
          result_handoff: "ghost-result",
        },
      },
    });
    const diags = await spectralLint(dsl);
    const invRef = diags.filter(
      (d) => d.ruleId === "task-invocation-handoff-ref",
    );
    const resRef = diags.filter(
      (d) => d.ruleId === "task-result-handoff-ref",
    );
    expect(invRef.length).toBe(1);
    expect(resRef.length).toBe(1);
  });

  it("passes when all references are valid", async () => {
    const dsl = makeDsl({
      agents: {
        arch: {
          role_name: "A",
          purpose: "P",
          can_read_artifacts: ["spec"],
          can_write_artifacts: [],
          can_execute_tools: [],
          can_perform_validations: [],
          can_invoke_agents: [],
          can_return_handoffs: [],
        },
      },
      artifacts: {
        spec: {
          type: "document",
          owner: "arch",
          producers: ["arch"],
          editors: ["arch"],
          consumers: ["arch"],
          states: ["draft"],
          required_validations: [],
        },
      },
    });
    const diags = await spectralLint(dsl);
    const refErrors = diags.filter(
      (d) => d.ruleId.endsWith("-ref") && d.severity === "error",
    );
    expect(refErrors).toHaveLength(0);
  });
});

describe("Spectral lint — artifact responsibility integrity", () => {
  it("detects empty editors", async () => {
    const dsl = makeDsl({
      agents: {
        a: {
          role_name: "A",
          purpose: "P",
          can_read_artifacts: [],
          can_write_artifacts: [],
          can_execute_tools: [],
          can_perform_validations: [],
          can_invoke_agents: [],
          can_return_handoffs: [],
        },
      },
      artifacts: {
        art: {
          type: "document",
          owner: "a",
          producers: ["a"],
          editors: [],
          consumers: ["a"],
          states: ["draft"],
          required_validations: [],
        },
      },
    });
    const diags = await spectralLint(dsl);
    const ed = diags.filter((d) => d.ruleId === "artifact-editors-not-empty");
    expect(ed.length).toBe(1);
  });

  it("skips empty editors when all deprecated ownership fields are empty", async () => {
    const dsl = makeDsl({
      agents: {
        a: {
          role_name: "A",
          purpose: "P",
          can_read_artifacts: [],
          can_write_artifacts: [],
          can_execute_tools: [],
          can_perform_validations: [],
          can_invoke_agents: [],
          can_return_handoffs: [],
        },
      },
      artifacts: {
        art: {
          type: "document",
          producers: [],
          editors: [],
          consumers: [],
          states: ["draft"],
          required_validations: [],
        },
      },
    });
    const diags = await spectralLint(dsl);
    const ed = diags.filter((d) => d.ruleId === "artifact-editors-not-empty");
    expect(ed).toHaveLength(0);
  });
});

describe("Spectral lint — handoff integrity", () => {
  it("detects workflow step referencing non-existent handoff_kind", async () => {
    const dsl = makeDsl({
      workflow: {
        implement: {
          entry_conditions: [],
          steps: [
            { type: "handoff", handoff_kind: "nonexistent-kind" },
          ],
        },
      },
    });
    const diags = await spectralLint(dsl);
    const wf = diags.filter((d) => d.ruleId === "workflow-step-refs");
    expect(wf.length).toBeGreaterThan(0);
    expect(wf[0].message).toContain("nonexistent-kind");
  });
});

describe("Spectral lint — agent behavioral integrity", () => {
  it("detects read-only agent with can_write_artifacts", async () => {
    const dsl = makeDsl({
      agents: {
        pol: {
          role_name: "Police",
          purpose: "Audit",
          mode: "read-only",
          can_read_artifacts: ["spec"],
          can_write_artifacts: ["spec"],
          can_execute_tools: [],
          can_perform_validations: [],
          can_invoke_agents: [],
          can_return_handoffs: [],
        },
      },
      artifacts: {
        spec: {
          type: "document",
          owner: "pol",
          producers: ["pol"],
          editors: ["pol"],
          consumers: [],
          states: ["draft"],
          required_validations: [],
        },
      },
    });
    const diags = await spectralLint(dsl);
    const ro = diags.filter((d) => d.ruleId === "readonly-agent-no-writes");
    expect(ro.length).toBe(1);
    expect(ro[0].message).toContain("read-only");
  });

  it("detects prerequisite target not in can_read_artifacts", async () => {
    const dsl = makeDsl({
      agents: {
        arch: {
          role_name: "A",
          purpose: "P",
          can_read_artifacts: ["other-art"],
          can_write_artifacts: [],
          can_execute_tools: [],
          can_perform_validations: [],
          can_invoke_agents: [],
          can_return_handoffs: [],
          prerequisites: [{ action: "read", target: "spec-md", required: true }],
        },
      },
    });
    const diags = await spectralLint(dsl);
    const pr = diags.filter(
      (d) => d.ruleId === "agent-prerequisite-readable",
    );
    expect(pr.length).toBe(1);
    expect(pr[0].message).toContain("spec-md");
  });
});

describe("Spectral lint — handoff schema integrity", () => {
  it("detects required field not in properties", async () => {
    const dsl = makeDsl({
      handoff_types: {
        "task-delegation": {
          version: 1,
          schema: {
            type: "object",
            required: ["objective", "missing_field"],
            properties: {
              objective: { type: "string" },
            },
          },
        },
      },
    });
    const diags = await spectralLint(dsl);
    const pl = diags.filter((d) => d.ruleId === "handoff-payload-integrity");
    expect(pl.length).toBe(1);
    expect(pl[0].message).toContain("missing_field");
  });

  it("detects empty enum", async () => {
    const dsl = makeDsl({
      handoff_types: {
        verdict: {
          version: 1,
          schema: {
            type: "object",
            properties: {
              status: { type: "string", enum: [] },
            },
          },
        },
      },
    });
    const diags = await spectralLint(dsl);
    const pl = diags.filter((d) => d.ruleId === "handoff-payload-integrity");
    expect(pl.length).toBe(1);
    expect(pl[0].message).toContain("enum");
  });

  it("detects nested required/properties mismatch", async () => {
    const dsl = makeDsl({
      handoff_types: {
        report: {
          version: 1,
          schema: {
            type: "object",
            properties: {
              details: {
                type: "object",
                required: ["summary", "ghost"],
                properties: {
                  summary: { type: "string" },
                },
              },
            },
          },
        },
      },
    });
    const diags = await spectralLint(dsl);
    const pl = diags.filter((d) => d.ruleId === "handoff-payload-integrity");
    expect(pl.length).toBe(1);
    expect(pl[0].message).toContain("ghost");
  });

  it("validates allOf schema by merging sub-schemas", async () => {
    const dsl = makeDsl({
      handoff_types: {
        delegation: {
          version: 1,
          schema: {
            allOf: [
              {
                type: "object",
                required: ["from_agent"],
                properties: {
                  from_agent: { type: "string" },
                },
              },
              {
                type: "object",
                required: ["payload"],
                properties: {
                  payload: { type: "object" },
                },
              },
            ],
          },
        },
      },
    });
    const diags = await spectralLint(dsl);
    const pl = diags.filter((d) => d.ruleId === "handoff-payload-integrity");
    expect(pl).toHaveLength(0);
  });
});

describe("Spectral lint — naming convention", () => {
  it("warns on non-kebab-case agent keys", async () => {
    const dsl = makeDsl({
      agents: {
        mainArchitect: {
          role_name: "A",
          purpose: "P",
          can_read_artifacts: [],
          can_write_artifacts: [],
          can_execute_tools: [],
          can_perform_validations: [],
          can_invoke_agents: [],
          can_return_handoffs: [],
        },
      },
    });
    const diags = await spectralLint(dsl);
    const naming = diags.filter((d) => d.ruleId === "agent-key-casing");
    expect(naming.length).toBeGreaterThan(0);
  });

  it("passes kebab-case keys", async () => {
    const dsl = makeDsl({
      agents: {
        "main-architect": {
          role_name: "A",
          purpose: "P",
          can_read_artifacts: [],
          can_write_artifacts: [],
          can_execute_tools: [],
          can_perform_validations: [],
          can_invoke_agents: [],
          can_return_handoffs: [],
        },
      },
    });
    const diags = await spectralLint(dsl);
    const naming = diags.filter((d) => d.ruleId === "agent-key-casing");
    expect(naming).toHaveLength(0);
  });
});

describe("Spectral lint — version", () => {
  it("rejects version != 1", async () => {
    const dsl = makeDsl({ version: 2 });
    const diags = await spectralLint(dsl);
    const ver = diags.filter((d) => d.ruleId === "version-must-be-1");
    expect(ver.length).toBe(1);
  });
});
