import { resolveAllOf } from "./json-schema-utils.js";

type AnyRecord = Record<string, unknown>;

const COMPONENTS_REF_PATTERN = /^#\/components\/schemas\/(.+)$/;

export function resolveSchemaRefs(
  schema: AnyRecord,
  components: Record<string, AnyRecord> = {},
): AnyRecord {
  const resolved = resolveRefsDeep(schema, components, new Set());
  return resolveAllOf(resolved);
}

function resolveRefsDeep(
  schema: AnyRecord,
  components: Record<string, AnyRecord>,
  resolving: Set<string>,
): AnyRecord {
  const ref = schema["$ref"];
  if (typeof ref === "string") {
    const match = ref.match(COMPONENTS_REF_PATTERN);
    if (match) {
      const name = match[1];
      if (resolving.has(name)) return schema;
      const target = components[name];
      if (target && typeof target === "object") {
        resolving.add(name);
        try {
          return resolveRefsDeep({ ...target }, components, resolving);
        } finally {
          resolving.delete(name);
        }
      }
    }
    return schema;
  }

  const result: AnyRecord = { ...schema };

  const allOf = schema["allOf"];
  if (Array.isArray(allOf)) {
    result["allOf"] = allOf.map((sub) =>
      typeof sub === "object" && sub !== null && !Array.isArray(sub)
        ? resolveRefsDeep(sub as AnyRecord, components, resolving)
        : sub,
    );
  }

  const props = schema["properties"];
  if (props && typeof props === "object") {
    const resolvedProps: AnyRecord = {};
    for (const [key, value] of Object.entries(props as AnyRecord)) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        resolvedProps[key] = resolveRefsDeep(
          value as AnyRecord,
          components,
          resolving,
        );
      } else {
        resolvedProps[key] = value;
      }
    }
    result["properties"] = resolvedProps;
  }

  const items = schema["items"];
  if (items && typeof items === "object" && !Array.isArray(items)) {
    result["items"] = resolveRefsDeep(items as AnyRecord, components, resolving);
  }

  for (const combiner of ["oneOf", "anyOf"] as const) {
    const values = schema[combiner];
    if (Array.isArray(values)) {
      result[combiner] = values.map((sub) =>
        typeof sub === "object" && sub !== null && !Array.isArray(sub)
          ? resolveRefsDeep(sub as AnyRecord, components, resolving)
          : sub,
      );
    }
  }

  return result;
}
