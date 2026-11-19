import type { RuleFunction } from "../types.js";

const KEBAB_CASE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** Flags a non-empty string that is not kebab-case (`agent-1`, `spec-md`). */
const kebabCase: RuleFunction = (value) =>
  typeof value === "string" && value.length > 0 && !KEBAB_CASE.test(value) ? [{}] : [];

export default kebabCase;
