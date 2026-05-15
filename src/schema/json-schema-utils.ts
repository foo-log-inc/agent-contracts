type AnyRecord = Record<string, unknown>;

/**
 * Recursively merge `allOf` arrays in a JSON Schema.
 *
 * Each `allOf` sub-schema is itself resolved first (handling nested
 * `allOf`), then `properties`, `required`, and top-level scalars are
 * merged. After merging, nested property schemas that contain their
 * own `allOf` are also resolved so the output is fully flattened.
 */
export function resolveAllOf(
  schema: AnyRecord,
): AnyRecord {
  const allOf = schema["allOf"];
  if (!Array.isArray(allOf)) return resolveNestedProperties(schema);

  let mergedProperties: AnyRecord = {};
  let mergedRequired: string[] = [];
  const mergedTop: AnyRecord = {};

  for (const sub of allOf) {
    if (typeof sub !== "object" || sub === null || Array.isArray(sub)) continue;
    const subSchema = resolveAllOf(sub as AnyRecord);

    if (
      subSchema["properties"] &&
      typeof subSchema["properties"] === "object"
    ) {
      mergedProperties = {
        ...mergedProperties,
        ...(subSchema["properties"] as AnyRecord),
      };
    }

    if (Array.isArray(subSchema["required"])) {
      mergedRequired = [
        ...mergedRequired,
        ...(subSchema["required"] as string[]),
      ];
    }

    for (const [key, value] of Object.entries(subSchema)) {
      if (key !== "properties" && key !== "required" && key !== "allOf") {
        mergedTop[key] = value;
      }
    }
  }

  for (const [key, value] of Object.entries(schema)) {
    if (key === "allOf") continue;
    if (key === "properties" && typeof value === "object") {
      mergedProperties = { ...mergedProperties, ...(value as AnyRecord) };
    } else if (key === "required" && Array.isArray(value)) {
      mergedRequired = [...mergedRequired, ...(value as string[])];
    } else {
      mergedTop[key] = value;
    }
  }

  const result: AnyRecord = { ...mergedTop };
  if (Object.keys(mergedProperties).length > 0) {
    result["properties"] = resolvePropertySchemas(mergedProperties);
  }
  if (mergedRequired.length > 0) {
    result["required"] = [...new Set(mergedRequired)];
  }
  return result;
}

function resolveNestedProperties(schema: AnyRecord): AnyRecord {
  const props = schema["properties"];
  if (!props || typeof props !== "object") return schema;
  return { ...schema, properties: resolvePropertySchemas(props as AnyRecord) };
}

function resolvePropertySchemas(properties: AnyRecord): AnyRecord {
  const result: AnyRecord = {};
  for (const [key, value] of Object.entries(properties)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const propSchema = value as AnyRecord;
      result[key] = propSchema["allOf"] ? resolveAllOf(propSchema) : propSchema;
    } else {
      result[key] = value;
    }
  }
  return result;
}
