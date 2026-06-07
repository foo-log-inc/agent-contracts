import { describe, it, expect } from "vitest";
import { resolveSchemaRefs } from "../../src/schema/resolve-schema-refs.js";

describe("resolveSchemaRefs", () => {
  it("resolves $ref to components.schemas before flattening allOf", () => {
    const components = {
      BaseHandoff: {
        type: "object",
        properties: {
          from_agent: { type: "string" },
          to_agent: { type: "string" },
        },
        required: ["from_agent", "to_agent"],
      },
    };

    const schema = {
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
    };

    const resolved = resolveSchemaRefs(schema, components);
    const props = resolved.properties as Record<string, unknown>;
    expect(props).toHaveProperty("from_agent");
    expect(props).toHaveProperty("to_agent");
    expect(props).toHaveProperty("payload");
    expect(resolved.required).toEqual(
      expect.arrayContaining(["from_agent", "to_agent"]),
    );
  });
});
