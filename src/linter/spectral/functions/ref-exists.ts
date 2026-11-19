import type { RuleFunction, RuleResult } from "../types.js";

/**
 * Validates that each string in the value (single string or string[]) is a
 * key of the document's top-level map `referenceTo`.
 */
export default function refExists(referenceTo: string): RuleFunction {
  return (value, context) => {
    const catalog = context.document[referenceTo];
    if (typeof catalog !== "object" || catalog === null) return [];

    const keys = new Set(Object.keys(catalog));
    const values = Array.isArray(value) ? value : [value];
    const results: RuleResult[] = [];

    for (let i = 0; i < values.length; i++) {
      const v: unknown = values[i];
      if (typeof v !== "string") continue;
      if (!keys.has(v)) {
        const path = Array.isArray(value) ? [...context.path, i] : [...context.path];
        results.push({
          message: `"${v}" does not exist in ${referenceTo}`,
          path,
        });
      }
    }
    return results;
  };
}
