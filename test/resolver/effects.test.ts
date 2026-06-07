import { resolve, join } from "node:path";
import { describe, it, expect } from "vitest";
import { DslSchema, type Dsl } from "../../src/schema/index.js";
import {
  resolveAgentEffects,
  resolveTaskEffects,
  isNarrowOnlyOverride,
  collectAgentArtifactProducers,
  collectAgentArtifactConsumers,
} from "../../src/resolver/effects.js";

const fixturesDir = resolve(import.meta.dirname, "../fixtures");
const speckeeperCliContract = join(fixturesDir, "cli-contracts/speckeeper-cli-contract.yaml");

function makeDsl(partial: Partial<Record<string, unknown>>): Dsl {
  return DslSchema.parse({
    version: 1,
    system: { id: "s", name: "S", default_workflow_order: ["implement"] },
    ...partial,
  });
}

describe("resolveAgentEffects", () => {
  it("aggregates read/write effects from cli_contract artifact_bindings", () => {
    const dsl = makeDsl({
      agents: {
        a1: { role_name: "R", purpose: "P", can_execute_tools: ["speckeeper"] },
      },
      artifacts: {
        spec: { type: "doc", owner: "a1", producers: ["a1"], editors: ["a1"], consumers: ["a1"], states: ["draft"] },
        output: { type: "doc", owner: "a1", producers: ["a1"], editors: ["a1"], consumers: ["a1"], states: ["draft"] },
      },
      tools: {
        speckeeper: {
          kind: "cli",
          invokable_by: ["a1"],
          cli_contract: speckeeperCliContract,
          command: "build",
          artifact_bindings: {
            "spec-source": "spec",
            "output-docs": "output",
          },
        },
      },
    });

    const effects = resolveAgentEffects(dsl, "a1");
    expect(effects.derived).toContain("read:spec");
    expect(effects.derived).toContain("write:output");
    expect(effects.effective).toEqual(effects.derived);
  });

  it("applies narrow-only override from agent.effects", () => {
    const dsl = makeDsl({
      agents: {
        a1: {
          role_name: "R",
          purpose: "P",
          can_execute_tools: ["speckeeper"],
          effects: ["read:spec"],
        },
      },
      artifacts: {
        spec: { type: "doc", owner: "a1", producers: ["a1"], editors: ["a1"], consumers: ["a1"], states: ["draft"] },
        output: { type: "doc", owner: "a1", producers: ["a1"], editors: ["a1"], consumers: ["a1"], states: ["draft"] },
      },
      tools: {
        speckeeper: {
          kind: "cli",
          invokable_by: ["a1"],
          cli_contract: speckeeperCliContract,
          command: "build",
          artifact_bindings: {
            "spec-source": "spec",
            "output-docs": "output",
          },
        },
      },
    });

    const effects = resolveAgentEffects(dsl, "a1");
    expect(effects.override).toEqual(["read:spec"]);
    expect(effects.effective).toEqual(["read:spec"]);
    expect(isNarrowOnlyOverride(effects.derived, effects.override)).toBe(true);
  });

  it("detects invalid narrow-only override", () => {
    const derived = ["read:spec", "write:output"];
    expect(isNarrowOnlyOverride(derived, ["read:spec"])).toBe(true);
    expect(isNarrowOnlyOverride(derived, ["network:api"])).toBe(false);
  });
});

describe("resolveTaskEffects", () => {
  it("includes execution step tool effects in derived set", () => {
    const dsl = makeDsl({
      agents: {
        a1: { role_name: "R", purpose: "P", can_execute_tools: [] },
      },
      artifacts: {
        spec: { type: "doc", owner: "a1", producers: ["a1"], editors: ["a1"], consumers: ["a1"], states: ["draft"] },
      },
      tools: {
        speckeeper: {
          kind: "cli",
          invokable_by: ["a1"],
          cli_contract: speckeeperCliContract,
          command: "lint",
          artifact_bindings: { "spec-source": "spec" },
        },
      },
      tasks: {
        t1: {
          description: "Lint",
          target_agent: "a1",
          allowed_from_agents: ["a1"],
          workflow: "implement",
          input_artifacts: [],
          invocation_handoff: "h",
          result_handoff: "h",
          execution_steps: [{ id: "s1", action: "lint", uses_tool: "speckeeper" }],
        },
      },
    });

    const effects = resolveTaskEffects(dsl, "t1");
    expect(effects.derived).toContain("read:spec");
  });
});

describe("artifact producer/consumer collection", () => {
  it("collects producers from agents, tools, and execution steps", () => {
    const dsl = makeDsl({
      agents: {
        a1: { role_name: "R", purpose: "P", can_write_artifacts: ["out"] },
      },
      artifacts: {
        out: { type: "doc", owner: "a1", producers: ["a1"], editors: ["a1"], consumers: ["a1"], states: ["draft"] },
      },
      tools: {
        t1: { kind: "cli", invokable_by: ["a1"], output_artifacts: ["out"] },
      },
      tasks: {
        t1: {
          description: "D",
          target_agent: "a1",
          allowed_from_agents: ["a1"],
          workflow: "implement",
          input_artifacts: [],
          invocation_handoff: "h",
          result_handoff: "h",
          execution_steps: [{ id: "s1", action: "write", produces_artifact: "out" }],
        },
      },
    });

    const producers = collectAgentArtifactProducers(dsl, "out");
    expect(producers.has("agent:a1")).toBe(true);
    expect(producers.has("tool:t1")).toBe(true);
    expect(producers.has("task:t1")).toBe(true);

    const consumers = collectAgentArtifactConsumers(dsl, "out");
    expect(consumers.size).toBeGreaterThanOrEqual(0);
  });
});
