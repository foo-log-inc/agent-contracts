import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { resolve as resolveDsl } from "../../src/resolver/index.js";
import { validateSchema } from "../../src/validator/index.js";
import { buildAuditContext } from "../../src/auditor/context-builder.js";
import type { ResolvedConfig } from "../../src/config/types.js";

const minimalDsl = resolve(import.meta.dirname, "../fixtures/minimal/agent-contracts.yaml");

const stubConfig: ResolvedConfig = {
  dsl: minimalDsl,
  renders: [],
  configDir: resolve(import.meta.dirname, "../fixtures/minimal"),
  bindings: [],
};

async function loadDsl() {
  const resolved = await resolveDsl(minimalDsl);
  const schema = validateSchema(resolved.data);
  if (!schema.success || !schema.data) throw new Error("schema validation failed");
  return schema.data;
}

describe("buildAuditContext", () => {
  it("builds context for dsl audit type", async () => {
    const dsl = await loadDsl();
    const context = await buildAuditContext("dsl", dsl, stubConfig);
    expect(context).toContain("## DSL Overview");
    expect(context).toContain("## Agent Definitions");
    expect(context).toContain("## Tasks");
    expect(context).toContain("## Workflows");
  });

  it("builds context for render audit type", async () => {
    const dsl = await loadDsl();
    const context = await buildAuditContext("render", dsl, stubConfig);
    expect(context).toContain("## DSL Overview");
    expect(context).toContain("## Agent DSL Definitions");
    expect(context).toContain("## Generated Prompt Files");
  });

  it("builds context for prompt audit type", async () => {
    const dsl = await loadDsl();
    const context = await buildAuditContext("prompt", dsl, stubConfig);
    expect(context).toContain("## DSL Overview");
    expect(context).toContain("## Agent DSL Definitions");
    expect(context).toContain("## Generated Prompt Files");
  });

  it("includes agent names in dsl overview", async () => {
    const dsl = await loadDsl();
    const context = await buildAuditContext("dsl", dsl, stubConfig);
    expect(context).toContain("- System: minimal-system");
  });
});
