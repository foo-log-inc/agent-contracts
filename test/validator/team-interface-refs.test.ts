import { describe, expect, it } from "vitest";
import { DslSchema } from "../../src/schema/index.js";
import { checkReferences } from "../../src/validator/reference-resolver.js";

const handoff = { version: 1, schema: { type: "object" } };

function minimalArtifact(owner = "a1") {
  return {
    type: "code",
    owner,
    producers: [owner],
    editors: [owner],
    consumers: [owner],
    states: ["draft"],
  };
}

function buildBaseDsl() {
  return {
    version: 1,
    system: {
      id: "sys",
      name: "System",
      default_workflow_order: ["feature-implement", "w1"],
    },
    agents: {
      a1: {
        role_name: "R",
        purpose: "P",
        can_read_artifacts: ["api_contract"],
      },
    },
    artifacts: {
      api_contract: minimalArtifact(),
    },
    handoff_types: {
      "task-delegation": handoff,
      "feature-request": handoff,
      "implementation-result": handoff,
      "h-in": handoff,
      "h-out": handoff,
    },
    workflow: {
      "feature-implement": {
        steps: [{ type: "handoff" as const, handoff_kind: "task-delegation" }],
      },
      w1: {
        steps: [
          {
            type: "team_task" as const,
            to_team: "backend",
            workflow: "implement",
            handoff: "h-in",
            expects: "h-out",
          },
        ],
      },
    },
    imports: {
      backend: { interface: "./teams/backend/team-interface.yaml" },
    },
    team_interface: {
      version: 1,
      accepts: {
        workflows: {
          implement: {
            internal_workflow: "feature-implement",
            input_handoff: "feature-request",
            output_handoff: "implementation-result",
          },
        },
      },
      exposes: { artifacts: ["api_contract"] },
    },
  };
}

describe("checkReferences team_interface and team_task", () => {
  it("has no diagnostics for team_interface with valid internal refs", () => {
    const dsl = DslSchema.parse(buildBaseDsl());
    expect(checkReferences(dsl)).toEqual([]);
  });

  it("reports team-interface-workflow-not-found for unknown internal workflow", () => {
    const raw = buildBaseDsl();
    raw.team_interface = {
      version: 1,
      accepts: {
        workflows: {
          implement: {
            internal_workflow: "missing-workflow",
            input_handoff: "feature-request",
            output_handoff: "implementation-result",
          },
        },
      },
    };
    const dsl = DslSchema.parse(raw);
    const diagnostics = checkReferences(dsl);
    expect(diagnostics.some((d) => d.code === "team-interface-workflow-not-found")).toBe(true);
  });

  it("reports team-interface-handoff-not-found for unknown handoff ref", () => {
    const raw = buildBaseDsl();
    raw.team_interface = {
      version: 1,
      accepts: {
        workflows: {
          implement: {
            internal_workflow: "feature-implement",
            input_handoff: "no-such-handoff",
            output_handoff: "implementation-result",
          },
        },
      },
    };
    const dsl = DslSchema.parse(raw);
    const diagnostics = checkReferences(dsl);
    expect(diagnostics.some((d) => d.code === "team-interface-handoff-not-found")).toBe(true);
  });

  it("reports team-interface-artifact-not-found for unknown exposed artifact", () => {
    const raw = buildBaseDsl();
    raw.team_interface = {
      version: 1,
      accepts: {
        workflows: {
          implement: {
            internal_workflow: "feature-implement",
            input_handoff: "feature-request",
            output_handoff: "implementation-result",
          },
        },
      },
      exposes: { artifacts: ["ghost-artifact"] },
    };
    const dsl = DslSchema.parse(raw);
    const diagnostics = checkReferences(dsl);
    expect(diagnostics.some((d) => d.code === "team-interface-artifact-not-found")).toBe(true);
  });

  it("has no diagnostics for team_task step when imports and handoffs are valid", () => {
    const dsl = DslSchema.parse(buildBaseDsl());
    const teamTaskDiags = checkReferences(dsl).filter((d) =>
      d.path.includes("steps[0]"),
    );
    expect(teamTaskDiags).toEqual([]);
  });

  it("reports team-task-missing-imports when dsl.imports is absent", () => {
    const raw = buildBaseDsl();
    delete (raw as { imports?: unknown }).imports;
    const dsl = DslSchema.parse(raw);
    const diagnostics = checkReferences(dsl);
    expect(diagnostics.some((d) => d.code === "team-task-missing-imports")).toBe(true);
  });

  it("reports team-import-not-found for team_task to_team not in imports", () => {
    const raw = buildBaseDsl();
    raw.imports = { other_team: { interface: "./other.yaml" } };
    const dsl = DslSchema.parse(raw);
    const diagnostics = checkReferences(dsl);
    expect(diagnostics.some((d) => d.code === "team-import-not-found")).toBe(true);
  });

  it("reports reference-not-found for team_task handoff / expects", () => {
    const raw = buildBaseDsl();
    raw.workflow = {
      ...raw.workflow,
      w1: {
        steps: [
          {
            type: "team_task" as const,
            to_team: "backend",
            workflow: "implement",
            handoff: "unknown-handoff",
            expects: "h-out",
          },
        ],
      },
    };
    const dsl = DslSchema.parse(raw);
    const diagnostics = checkReferences(dsl);
    const handoffRefs = diagnostics.filter(
      (d) => d.code === "reference-not-found" && d.path.includes("handoff"),
    );
    expect(handoffRefs.length).toBeGreaterThan(0);

    const raw2 = buildBaseDsl();
    raw2.workflow = {
      ...raw2.workflow,
      w1: {
        steps: [
          {
            type: "team_task" as const,
            to_team: "backend",
            workflow: "implement",
            handoff: "h-in",
            expects: "unknown-expects",
          },
        ],
      },
    };
    const dsl2 = DslSchema.parse(raw2);
    const diagnostics2 = checkReferences(dsl2);
    expect(
      diagnostics2.some(
        (d) => d.code === "reference-not-found" && d.path.includes("expects"),
      ),
    ).toBe(true);
  });
});
