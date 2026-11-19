import type { RuleFunction } from "../types.js";

/** Flags a scalar value (string, number, boolean or null) that is not one of `values`. */
export default function oneOf(values: readonly unknown[]): RuleFunction {
  return (value) => {
    const scalar =
      value === null || ["string", "number", "boolean"].includes(typeof value);
    return scalar && !values.includes(value) ? [{}] : [];
  };
}
