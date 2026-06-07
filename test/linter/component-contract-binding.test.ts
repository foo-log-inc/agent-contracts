import { resolve, join } from "node:path";
import { describe, it, expect } from "vitest";
import { DslSchema, type Dsl } from "../../src/schema/index.js";
import { componentContractBindingRule } from "../../src/linter/rules/component-contract-binding.js";

const fixturesDir = resolve(import.meta.dirname, "../fixtures");
const reviewComponent = join(fixturesDir, "component-contracts/review-component.yaml");

function makeDsl(partial: Partial<Record<string, unknown>>): Dsl {
  return DslSchema.parse({
    version: 1,
    system: { id: "s", name: "S", default_workflow_order: ["implement"] },
    ...partial,
  });
}

describe("componentContractBindingRule", () => {
  it("warns when component contract slots are missing from artifact_bindings", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P" } },
      artifacts: {
        diff: { type: "doc", owner: "a1", producers: ["a1"], editors: ["a1"], consumers: ["a1"], states: ["draft"] },
      },
      tools: {
        reviewer: {
          kind: "component",
          invokable_by: ["a1"],
          component_contract: reviewComponent,
          command: "review",
          artifact_bindings: {
            "source-diff": "diff",
          },
        },
      },
    });

    const diags = componentContractBindingRule.run(dsl);
    expect(diags.length).toBe(1);
    expect(diags[0].message).toContain("review-report");
  });

  it("passes when artifact_bindings cover all component slots", () => {
    const dsl = makeDsl({
      agents: { a1: { role_name: "R", purpose: "P" } },
      artifacts: {
        diff: { type: "doc", owner: "a1", producers: ["a1"], editors: ["a1"], consumers: ["a1"], states: ["draft"] },
        report: { type: "doc", owner: "a1", producers: ["a1"], editors: ["a1"], consumers: ["a1"], states: ["draft"] },
      },
      tools: {
        reviewer: {
          kind: "component",
          invokable_by: ["a1"],
          component_contract: reviewComponent,
          command: "review",
          artifact_bindings: {
            "source-diff": "diff",
            "review-report": "report",
          },
        },
      },
    });

    const diags = componentContractBindingRule.run(dsl);
    expect(diags).toHaveLength(0);
  });
});
