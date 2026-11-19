import { isRecord, type RuleFunction, type RuleResult } from "../types.js";

type SchemaObj = {
  required?: string[];
  properties?: Record<string, unknown>;
  allOf?: SchemaObj[];
  [key: string]: unknown;
};

function flattenAllOf(obj: SchemaObj): SchemaObj {
  if (!Array.isArray(obj.allOf)) return obj;
  let mergedProps: Record<string, unknown> = {};
  let mergedRequired: string[] = [];
  const mergedTop: Record<string, unknown> = {};

  for (const sub of obj.allOf) {
    if (typeof sub !== "object" || sub === null) continue;
    const flat = flattenAllOf(sub);
    if (flat.properties && typeof flat.properties === "object") {
      mergedProps = { ...mergedProps, ...flat.properties };
    }
    if (Array.isArray(flat.required)) {
      mergedRequired = [...mergedRequired, ...flat.required];
    }
    for (const [k, v] of Object.entries(flat)) {
      if (k !== "properties" && k !== "required" && k !== "allOf") {
        mergedTop[k] = v;
      }
    }
  }
  for (const [k, v] of Object.entries(obj)) {
    if (k === "allOf") continue;
    if (k === "properties" && typeof v === "object") {
      mergedProps = { ...mergedProps, ...(v as Record<string, unknown>) };
    } else if (k === "required" && Array.isArray(v)) {
      mergedRequired = [...mergedRequired, ...(v as string[])];
    } else {
      mergedTop[k] = v;
    }
  }
  const result: SchemaObj = { ...mergedTop };
  if (Object.keys(mergedProps).length > 0) result.properties = mergedProps;
  if (mergedRequired.length > 0) result.required = [...new Set(mergedRequired)];
  return result;
}

/**
 * Section 15.2.10: Handoff schema integrity.
 * - required fields must exist in properties
 * - enum arrays must not be empty
 * - nested objects: required fields must exist in their properties
 * - allOf sub-schemas are merged before checking
 */
const payloadSchemaIntegrity: RuleFunction = (value, context) => {
  if (!isRecord(value)) return [];
  const results: RuleResult[] = [];

  function checkObj(obj: SchemaObj, basePath: (string | number)[]) {
    const flat = flattenAllOf(obj);
    const required = flat.required;
    const properties = flat.properties;

    if (
      Array.isArray(required) &&
      typeof properties === "object" &&
      properties !== null
    ) {
      const propKeys = new Set(Object.keys(properties));
      for (let i = 0; i < required.length; i++) {
        if (!propKeys.has(required[i])) {
          results.push({
            message: `required field "${required[i]}" is not defined in properties`,
            path: [...basePath, "required", i],
          });
        }
      }
    }

    if (typeof properties === "object" && properties !== null) {
      for (const [key, schema] of Object.entries(properties)) {
        if (typeof schema !== "object" || schema === null) continue;
        const s = schema as Record<string, unknown>;

        if (Array.isArray(s.enum) && s.enum.length === 0) {
          results.push({
            message: `enum for "${key}" must not be empty`,
            path: [...basePath, "properties", key, "enum"],
          });
        }

        if (s.type === "object") {
          checkObj(s as SchemaObj, [...basePath, "properties", key]);
        }

        if (s.items && typeof s.items === "object") {
          const items = s.items as Record<string, unknown>;
          if (items.type === "object") {
            checkObj(items as SchemaObj, [
              ...basePath,
              "properties",
              key,
              "items",
            ]);
          }
        }
      }
    }
  }

  checkObj(value as SchemaObj, [...context.path]);
  return results;
};

export default payloadSchemaIntegrity;
