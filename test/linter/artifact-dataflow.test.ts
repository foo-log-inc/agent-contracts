import { describe, it, expect } from "vitest";
import { DslSchema, type Dsl } from "../../src/schema/index.js";
import { artifactDataflowRule } from "../../src/linter/rules/artifact-dataflow.js";

function makeDsl(partial: Partial<Record<string, unknown>>): Dsl {
  return DslSchema.parse({
    version: 1,
    system: { id: "s", name: "S", default_workflow_order: ["implement"] },
    ...partial,
  });
}

describe("artifactDataflowRule", () => {
  it("warns when artifact has no producer", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P" } },
      artifacts: {
        orphan: { type: "doc", owner: "a1", producers: [], editors: [], consumers: ["a1"], states: ["draft"] },
      },
    });

    const diags = artifactDataflowRule.run(dsl);
    expect(diags.some((d) => d.message.includes("no agent or tool that produces"))).toBe(true);
  });

  it("errors when derived_from references missing artifact", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P", can_write_artifacts: ["derived"] } },
      artifacts: {
        derived: {
          type: "doc",
          owner: "a1",
          producers: ["a1"],
          editors: ["a1"],
          consumers: ["a1"],
          states: ["draft"],
          derived_from: ["missing-source"],
        },
      },
    });

    const diags = artifactDataflowRule.run(dsl);
    expect(diags.some((d) => d.message.includes("non-existent artifact"))).toBe(true);
  });

  it("errors when consumer lacks read permission", () => {
    const dsl = makeDsl({
      agents: {
        a1: { role_name: "R", purpose: "P" },
        a2: { role_name: "R2", purpose: "P2" },
      },
      artifacts: {
        doc: {
          type: "doc",
          owner: "a1",
          producers: ["a1"],
          editors: ["a1"],
          consumers: ["a2"],
          states: ["draft"],
        },
      },
    });

    const diags = artifactDataflowRule.run(dsl);
    expect(diags.some((d) => d.message.includes("lacks read access"))).toBe(true);
  });
});
