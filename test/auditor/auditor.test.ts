import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { resolve as resolveDsl } from "../../src/resolver/index.js";
import { validateSchema } from "../../src/validator/index.js";
import { runAudit } from "../../src/auditor/auditor.js";
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

describe("runAudit", () => {
  it("returns prompt in show-prompt mode for render type", async () => {
    const dsl = await loadDsl();
    const result = await runAudit(dsl, stubConfig, {}, {
      auditType: "render",
      format: "text",
      showPrompt: true,
    });

    expect(result.showPrompt).toBe(true);
    expect(result.status).toBe("success");
    expect(result.taskId).toBe("audit-dsl-completeness");
    expect(result.prompt).toContain("## DSL Overview");
    expect(result.data).toBeNull();
  });

  it("returns prompt in show-prompt mode for dsl type", async () => {
    const dsl = await loadDsl();
    const result = await runAudit(dsl, stubConfig, {}, {
      auditType: "dsl",
      format: "text",
      showPrompt: true,
    });

    expect(result.showPrompt).toBe(true);
    expect(result.taskId).toBe("audit-semantic-design");
    expect(result.prompt).toContain("## Agent Definitions");
  });

  it("returns prompt in show-prompt mode for prompt type", async () => {
    const dsl = await loadDsl();
    const result = await runAudit(dsl, stubConfig, {}, {
      auditType: "prompt",
      format: "text",
      showPrompt: true,
    });

    expect(result.showPrompt).toBe(true);
    expect(result.taskId).toBe("audit-generated-prompts");
    expect(result.prompt).toContain("## Agent DSL Definitions");
  });

  it("maps audit types to correct task IDs", async () => {
    const dsl = await loadDsl();

    const r1 = await runAudit(dsl, stubConfig, {}, { auditType: "render", format: "text", showPrompt: true });
    const r2 = await runAudit(dsl, stubConfig, {}, { auditType: "dsl", format: "text", showPrompt: true });
    const r3 = await runAudit(dsl, stubConfig, {}, { auditType: "prompt", format: "text", showPrompt: true });

    expect(r1.taskId).toBe("audit-dsl-completeness");
    expect(r2.taskId).toBe("audit-semantic-design");
    expect(r3.taskId).toBe("audit-generated-prompts");
  });
});
