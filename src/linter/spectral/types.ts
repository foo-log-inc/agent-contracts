import type { Severity } from "../types.js";

/** A location in the DSL document as property names and array indices. */
export type DocumentPath = (string | number)[];

export interface RuleContext {
  /** The whole DSL document, as JSON data. */
  document: Record<string, unknown>;
  /** Location of the value passed to the rule function. */
  path: DocumentPath;
}

export interface RuleResult {
  /** Defaults to the rule's description. */
  message?: string;
  /** Defaults to the location of the checked value. */
  path?: DocumentPath;
}

export type RuleFunction = (value: unknown, context: RuleContext) => RuleResult[];

export interface DocumentRule {
  description: string;
  severity: Severity;
  /**
   * The values the rule checks: `$` followed by `.`-separated property
   * names, where `*` stands for every member of an object or array
   * (`$.artifacts.*.editors`).
   */
  given: string;
  then: {
    /** A property of each given value to check instead, or `@key` for each of its keys. */
    field?: string;
    function: RuleFunction;
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
