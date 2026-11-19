import { resolve } from "node:path";
import { describe, it, expect, vi } from "vitest";
import { resolve as resolveDsl } from "../../src/resolver/index.js";
import { validateSchema } from "../../src/validator/index.js";
import { runAudit } from "../../src/auditor/auditor.js";
import type { ResolvedConfig } from "../../src/config/types.js";

const { executeTask } = vi.hoisted(() => ({
  executeTask: vi.fn(async (_taskId: string, _options: unknown) => ({
    outcome: { status: "success", data: { total_dimensions: 0, pass_count: 0, miss_count: 0 }, raw: "{}" },
    follow_ups_used: 0,
    retries_used: 0,
  })),
}));

vi.mock("agent-contracts-runtime", () => ({ executeTask }));

const minimalDsl = resolve(import.meta.dirname, "../fixtures/minimal/agent-contracts.yaml");

const stubConfig: ResolvedConfig = {
  dsl: minimalDsl,
  renders: [],
  configDir: resolve(import.meta.dirname, "../fixtures/minimal"),
  bindings: [],
};

describe("runAudit adapter options", () => {
  it("runs the audit agent without tools", async () => {
    const resolved = await resolveDsl(minimalDsl);
    const schema = validateSchema(resolved.data);
    if (!schema.success || !schema.data) throw new Error("schema validation failed");

    await runAudit(schema.data, stubConfig, { adapter: "claude" }, {
      auditType: "dsl",
      format: "text",
      showPrompt: false,
    });

    expect(executeTask).toHaveBeenCalledTimes(1);
    const options = executeTask.mock.calls[0][1] as { adapter: string; adapterOptions?: { tools?: string[] } };
    expect(options.adapter).toBe("claude");
    expect(options.adapterOptions?.tools).toEqual([]);
  });
});
