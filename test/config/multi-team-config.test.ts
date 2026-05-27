import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { AgentContractsConfigSchema } from "../../src/config/types.js";
import { loadConfig } from "../../src/config/loader.js";

// Test schema validation
describe("AgentContractsConfigSchema multi-team", () => {
  it("accepts single-team config (backward compatible)", () => {
    const result = AgentContractsConfigSchema.safeParse({
      dsl: "./agent-contracts.yaml",
    });
    expect(result.success).toBe(true);
  });

  it("accepts multi-team config with _defaults", () => {
    const result = AgentContractsConfigSchema.safeParse({
      teams: {
        _defaults: {
          bindings: ["./bindings/common.yaml"],
          vars: { language: "TypeScript" },
          active_guardrail_policy: "default-enforcement",
        },
        backend: {
          dsl: "./teams/backend/agent-contracts.yaml",
          interface_output: "./teams/backend/team-interface.yaml",
          bindings: ["./teams/backend/bindings/obs.yaml"],
          vars: { team_name: "backend" },
        },
        qa: {
          dsl: "./teams/qa/agent-contracts.yaml",
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts multi-team config without _defaults", () => {
    const result = AgentContractsConfigSchema.safeParse({
      teams: {
        backend: { dsl: "./backend.yaml" },
        qa: { dsl: "./qa.yaml" },
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects config with both dsl and teams", () => {
    const result = AgentContractsConfigSchema.safeParse({
      dsl: "./agent-contracts.yaml",
      teams: { backend: { dsl: "./backend.yaml" } },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.message.includes("mutually exclusive")),
      ).toBe(true);
    }
  });

  it("rejects config with neither dsl nor teams", () => {
    const result = AgentContractsConfigSchema.safeParse({
      bindings: ["./something.yaml"],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) =>
          i.message.includes("Either dsl or teams"),
        ),
      ).toBe(true);
    }
  });

  it("rejects team without dsl", () => {
    const result = AgentContractsConfigSchema.safeParse({
      teams: {
        backend: { bindings: ["./b.yaml"] },
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) =>
          i.message.includes('Team "backend" must specify dsl'),
        ),
      ).toBe(true);
    }
  });

  it("allows _defaults without dsl", () => {
    const result = AgentContractsConfigSchema.safeParse({
      teams: {
        _defaults: { bindings: ["./common.yaml"] },
        backend: { dsl: "./backend.yaml" },
      },
    });
    expect(result.success).toBe(true);
  });
});

// Test loader with file fixtures
describe("loadConfig multi-team", () => {
  const fixtureDir = join(tmpdir(), "agc-multi-team-fixtures");

  beforeAll(() => {
    mkdirSync(resolve(fixtureDir, "teams/backend/bindings"), { recursive: true });
    mkdirSync(resolve(fixtureDir, "teams/qa"), { recursive: true });
    mkdirSync(resolve(fixtureDir, "bindings"), { recursive: true });

    const minimalDsl = `version: 1
system:
  id: test-team
  name: Test Team
  default_workflow_order:
    - analyze
`;
    writeFileSync(resolve(fixtureDir, "teams/backend/agent-contracts.yaml"), minimalDsl);
    writeFileSync(resolve(fixtureDir, "teams/qa/agent-contracts.yaml"), minimalDsl);

    writeFileSync(resolve(fixtureDir, "bindings/common.yaml"), "software: {}\n");
    writeFileSync(
      resolve(fixtureDir, "teams/backend/bindings/obs.yaml"),
      "software: {}\n",
    );

    const mergeTestConfig = `
teams:
  _defaults:
    bindings:
      - ./bindings/common.yaml
    vars:
      language: TypeScript
      mode: production
    paths:
      cursor_root: .cursor
      output_dir: ./out
    active_guardrail_policy: default-enforcement
  backend:
    dsl: ./teams/backend/agent-contracts.yaml
    bindings:
      - ./teams/backend/bindings/obs.yaml
    vars:
      mode: development
      team_name: backend
    paths:
      output_dir: ./backend-out
    active_guardrail_policy: strict-enforcement
`;
    writeFileSync(resolve(fixtureDir, "merge-test.config.yaml"), mergeTestConfig);

    const configContent = `
teams:
  _defaults:
    bindings:
      - ./bindings/common.yaml
    vars:
      language: TypeScript
    paths:
      cursor_root: .cursor
    active_guardrail_policy: default-enforcement
  backend:
    dsl: ./teams/backend/agent-contracts.yaml
    interface_output: ./teams/backend/team-interface.yaml
    vars:
      team_name: backend
  qa:
    dsl: ./teams/qa/agent-contracts.yaml
    vars:
      team_name: qa
`;
    writeFileSync(resolve(fixtureDir, "agent-contracts.config.yaml"), configContent);

    writeFileSync(
      resolve(fixtureDir, "single-team.config.yaml"),
      `dsl: ./teams/backend/agent-contracts.yaml\n`,
    );
  });

  afterAll(() => {
    rmSync(fixtureDir, { recursive: true, force: true });
  });

  it("loads multi-team config with resolved team configs", async () => {
    const config = await loadConfig(resolve(fixtureDir, "agent-contracts.config.yaml"));
    expect(config).not.toBeNull();
    expect(config!.teams).toBeDefined();
    expect(Object.keys(config!.teams!)).toEqual(["backend", "qa"]);

    const backend = config!.teams!.backend;
    expect(backend.dsl).toContain("teams/backend/agent-contracts.yaml");
    expect(backend.vars).toEqual({ language: "TypeScript", team_name: "backend" });
    expect(backend.bindings).toHaveLength(1);
    expect(backend.bindings[0]).toContain("bindings/common.yaml");
    expect(backend.activeGuardrailPolicy).toBe("default-enforcement");
    expect(backend.interfaceOutput).toContain("teams/backend/team-interface.yaml");
    expect(backend.paths).toEqual({ cursor_root: ".cursor" });

    const qa = config!.teams!.qa;
    expect(qa.dsl).toContain("teams/qa/agent-contracts.yaml");
    expect(qa.vars).toEqual({ language: "TypeScript", team_name: "qa" });
    expect(qa.activeGuardrailPolicy).toBe("default-enforcement");
    expect(qa.interfaceOutput).toBeUndefined();
  });

  it("loads single-team config without teams field (backward compatible)", async () => {
    const config = await loadConfig(resolve(fixtureDir, "single-team.config.yaml"));
    expect(config).not.toBeNull();
    expect(config!.teams).toBeUndefined();
    expect(config!.dsl).toContain("teams/backend/agent-contracts.yaml");
  });

  it("multi-team config has dsl as empty string", async () => {
    const config = await loadConfig(resolve(fixtureDir, "agent-contracts.config.yaml"));
    expect(config).not.toBeNull();
    expect(config!.dsl).toBe("");
  });

  it("prepends _defaults bindings before team bindings", async () => {
    const config = await loadConfig(resolve(fixtureDir, "merge-test.config.yaml"));
    const backend = config!.teams!.backend;
    expect(backend.bindings).toHaveLength(2);
    expect(backend.bindings[0]).toContain("bindings/common.yaml");
    expect(backend.bindings[1]).toContain("teams/backend/bindings/obs.yaml");
  });

  it("team vars override _defaults vars (shallow merge)", async () => {
    const config = await loadConfig(resolve(fixtureDir, "merge-test.config.yaml"));
    const backend = config!.teams!.backend;
    expect(backend.vars).toEqual({
      language: "TypeScript",
      mode: "development",
      team_name: "backend",
    });
  });

  it("team paths override _defaults paths (shallow merge)", async () => {
    const config = await loadConfig(resolve(fixtureDir, "merge-test.config.yaml"));
    const backend = config!.teams!.backend;
    expect(backend.paths).toEqual({
      cursor_root: ".cursor",
      output_dir: "./backend-out",
    });
  });

  it("team active_guardrail_policy overrides _defaults", async () => {
    const config = await loadConfig(resolve(fixtureDir, "merge-test.config.yaml"));
    const backend = config!.teams!.backend;
    expect(backend.activeGuardrailPolicy).toBe("strict-enforcement");
  });
});
