import { resolveAllOf } from "../schema/index.js";

type AnyRecord = Record<string, unknown>;

export interface HandoffTypeLike {
  id?: string;
  version?: number;
  schema?: AnyRecord;
  example?: AnyRecord;
}

/**
 * Resolve the payload object for a handoff type.
 * Uses `example` when defined; otherwise generates a skeleton from `schema`.
 */
export function resolveHandoffPayload(
  handoffType: HandoffTypeLike | null | undefined,
): AnyRecord {
  if (!handoffType) return {};
  if (
    handoffType.example &&
    typeof handoffType.example === "object" &&
    !Array.isArray(handoffType.example)
  ) {
    return handoffType.example;
  }
  if (handoffType.schema && typeof handoffType.schema === "object") {
    return exampleFromSchema(handoffType.schema);
  }
  return {};
}

/**
 * Build a handoff envelope `{ type, version, payload }` suitable for
 * runtime invocation files and documentation.
 */
export function buildHandoffEnvelope(
  handoffType: HandoffTypeLike | null | undefined,
  idOverride?: string,
): AnyRecord {
  if (!handoffType) return {};
  const type = idOverride ?? handoffType.id;
  return {
    ...(type ? { type } : {}),
    ...(handoffType.version !== undefined ? { version: handoffType.version } : {}),
    payload: resolveHandoffPayload(handoffType),
  };
}

function exampleFromSchema(schema: AnyRecord): AnyRecord {
  const effective = resolveAllOf(schema);
  if (
    effective["$ref"] &&
    !effective["properties"] &&
    !effective["type"]
  ) {
    return {};
  }
  return exampleFromJsonSchema(effective);
}

function exampleFromJsonSchema(schema: AnyRecord): AnyRecord {
  const type = schema["type"];
  if (type === "object" || schema["properties"]) {
    return exampleFromObjectSchema(schema);
  }
  return {};
}

function exampleFromObjectSchema(schema: AnyRecord): AnyRecord {
  const props = schema["properties"] as AnyRecord | undefined;
  if (!props) return {};

  const required = new Set(
    (schema["required"] as string[] | undefined) ?? [],
  );
  const result: AnyRecord = {};

  for (const [key, propSchema] of Object.entries(props)) {
    if (!required.has(key)) continue;
    result[key] = exampleFromPropertySchema(
      propSchema as AnyRecord,
      key,
    );
  }

  return result;
}

function exampleFromPropertySchema(
  schema: AnyRecord,
  propName: string,
): unknown {
  const effective = resolveAllOf(schema);

  if (effective["example"] !== undefined) return effective["example"];
  if (effective["const"] !== undefined) return effective["const"];

  const enumVals = effective["enum"] as unknown[] | undefined;
  if (enumVals && enumVals.length > 0) return enumVals[0];

  const type = effective["type"];
  if (type === "string" || (!type && effective["format"])) {
    return `<${propName}>`;
  }
  if (type === "integer") return 0;
  if (type === "number") return 0;
  if (type === "boolean") return false;
  if (type === "array") {
    const items = effective["items"] as AnyRecord | undefined;
    if (items && typeof items === "object") {
      return [exampleFromPropertySchema(items, "item")];
    }
    return [];
  }
  if (type === "object" || effective["properties"]) {
    return exampleFromObjectSchema(effective);
  }

  return null;
}
