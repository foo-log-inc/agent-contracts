import { readFileSync, rmSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, afterAll } from "vitest";
import { DslSchema, type Dsl } from "../../src/schema/index.js";
import { buildPerAgentContext } from "../../src/renderer/context.js";
import { renderFromConfig } from "../../src/renderer/renderer.js";
import type { ResolvedRenderTarget } from "../../src/config/types.js";

const templateDir = join(resolve(import.meta.dirname, "../fixtures"), "templates");
const outputDir = join(tmpdir(), "agc-handoff-roles-output");

afterAll(() => {
  if (existsSync(outputDir)) {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

function makeDsl(): Dsl {
  return DslSchema.parse({
    version: 1,
    system: { id: "s", name: "S", default_workflow_order: ["impl"] },
    components: {
      schemas: {
        BaseHandoff: {
          type: "object",
          properties: {
            from_agent: { type: "string" },
            to_agent: { type: "string" },
          },
          required: ["from_agent", "to_agent"],
        },
      },
    },
    agents: {
      producer: {
        role_name: "Producer",
        purpose: "Produces handoffs",
        can_invoke_agents: ["consumer"],
        can_return_handoffs: ["result"],
      },
      consumer: {
        role_name: "Consumer",
        purpose: "Consumes handoffs",
        can_return_handoffs: ["result"],
      },
    },
    tasks: {
      "do-work": {
        description: "Do work",
        target_agent: "consumer",
        allowed_from_agents: ["producer"],
        workflow: "impl",
        input_artifacts: [],
        invocation_handoff: "delegation",
        result_handoff: "result",
      },
    },
    handoff_types: {
      delegation: {
        version: 1,
        description: "Task delegation",
        schema: {
          allOf: [
            { $ref: "#/components/schemas/BaseHandoff" },
            {
              type: "object",
              properties: {
                payload: {
                  type: "object",
                  properties: { objective: { type: "string" } },
                },
              },
            },
          ],
        },
      },
      result: {
        version: 1,
        description: "Task result",
        schema: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["success", "failure"] },
          },
          required: ["status"],
        },
      },
    },
  });
}

describe("handoff role rendering", () => {
  it("builds producer and consumer handoff views with resolved schemas", () => {
    const dsl = makeDsl();
    const producerCtx = buildPerAgentContext(dsl, {
      ...dsl.agents.producer,
      id: "producer",
    });
    const consumerCtx = buildPerAgentContext(dsl, {
      ...dsl.agents.consumer,
      id: "consumer",
    });

    expect(producerCtx.producerHandoffs.some((h) => h.handoffId === "delegation")).toBe(true);
    expect(consumerCtx.consumerHandoffs.some((h) => h.handoffId === "delegation")).toBe(true);
    expect(consumerCtx.producerHandoffs.some((h) => h.handoffId === "result")).toBe(true);
    expect(producerCtx.consumerHandoffs.some((h) => h.handoffId === "result")).toBe(true);

    const delegationProducer = producerCtx.producerHandoffs.find(
      (h) => h.handoffId === "delegation",
    );
    expect(delegationProducer?.fields.map((f) => f.name)).toEqual(
      expect.arrayContaining(["from_agent", "to_agent", "payload"]),
    );
    expect(delegationProducer?.resolvedSchema.properties).toHaveProperty("from_agent");
  });

  it("renders producer/consumer handoff sections into agent prompt", async () => {
    const dsl = makeDsl();
    const targets: ResolvedRenderTarget[] = [
      {
        template: join(templateDir, "agent-prompt.md.hbs"),
        context: "agent",
        output: join(outputDir, "{agent.id}.md"),
        include: ["producer", "consumer"],
      },
    ];

    const files = await renderFromConfig(dsl, targets);
    const producerFile = files.find((f) => f.includes("producer"));
    const consumerFile = files.find((f) => f.includes("consumer"));
    expect(producerFile).toBeDefined();
    expect(consumerFile).toBeDefined();

    const producerContent = readFileSync(producerFile!, "utf8");
    const consumerContent = readFileSync(consumerFile!, "utf8");

    expect(producerContent).toContain("Handoff Output Formats");
    expect(producerContent).toContain("delegation");
    expect(producerContent).toContain("from_agent");

    expect(consumerContent).toContain("Handoff Input Formats");
    expect(consumerContent).toContain("delegation");
    expect(consumerContent).toContain("result");
  });
});
