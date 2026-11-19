import ruleset from "./spectral/ruleset.js";
import type { DocumentPath } from "./spectral/types.js";
import type { LintDiagnostic } from "./types.js";

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The values a `given` path selects, with their locations. */
function select(
  node: unknown,
  segments: string[],
  path: string[],
): { value: unknown; path: string[] }[] {
  if (segments.length === 0) return [{ value: node, path }];
  if (!isObjectLike(node)) return [];
  const [head, ...rest] = segments;
  const keys = head === "*" ? Object.keys(node) : Object.hasOwn(node, head) ? [head] : [];
  return keys.flatMap((key) => select(node[key], rest, [...path, key]));
}

/** What a rule's function checks for one given value: the value, its `field`, or each of its keys. */
function targets(value: unknown, field: string | undefined): { value: unknown; path: string[] }[] {
  if (field === undefined || !isObjectLike(value)) return [{ value, path: [] }];
  if (field !== "@key") return [{ value: value[field], path: [field] }];
  const keys = Object.keys(value);
  return keys.length > 0
    ? keys.map((key) => ({ value: key, path: [key] }))
    : [{ value: undefined, path: [] }];
}

/** The longest leading part of `path` that exists in the document. */
function existingPath(document: unknown, path: DocumentPath): string[] {
  const result: string[] = [];
  let node = document;
  for (const segment of path.map(String)) {
    if (!isObjectLike(node) || !Object.hasOwn(node, segment)) break;
    result.push(segment);
    node = node[segment];
  }
  return result;
}

/** Position of every location in document order (a value comes before its members). */
function documentOrder(document: unknown): Map<string, number> {
  const order = new Map<string, number>();
  const visit = (node: unknown, path: string[]) => {
    order.set(JSON.stringify(path), order.size);
    if (isObjectLike(node)) {
      for (const [key, value] of Object.entries(node)) visit(value, [...path, key]);
    }
  };
  visit(document, []);
  return order;
}

/**
 * Run the reference-integrity, behavioral-spec, handoff-schema, naming and
 * version rules on a resolved DSL object.
 *
 * The rules read the DSL as JSON data. A diagnostic's path is the deepest
 * location of the finding that exists in the document. Diagnostics are
 * reported once per rule, path and message, in document order (then by rule
 * and path).
 */
export async function spectralLint(
  dslObject: Record<string, unknown>,
): Promise<LintDiagnostic[]> {
  const document = JSON.parse(JSON.stringify(dslObject)) as Record<string, unknown>;
  const order = documentOrder(document);
  const seen = new Set<string>();
  const found: (LintDiagnostic & { at: number; segments: string[] })[] = [];

  for (const [ruleId, rule] of Object.entries(ruleset)) {
    for (const node of select(document, rule.given.split(".").slice(1), [])) {
      for (const target of targets(node.value, rule.then.field)) {
        const context = { document, path: [...node.path, ...target.path] };
        for (const result of rule.then.function(target.value, context)) {
          const segments = existingPath(document, result.path ?? context.path);
          const message = result.message ?? rule.description;
          const key = ruleId + JSON.stringify(segments) + message;
          if (seen.has(key)) continue;
          seen.add(key);
          found.push({
            ruleId,
            severity: rule.severity,
            path: segments.join("."),
            message,
            at: order.get(JSON.stringify(segments))!,
            segments,
          });
        }
      }
    }
  }

  return found
    .sort(
      (a, b) =>
        a.at - b.at ||
        a.ruleId.localeCompare(b.ruleId, undefined, { numeric: true }) ||
        a.segments.join().localeCompare(b.segments.join()),
    )
    .map(({ ruleId, severity, path, message }) => ({ ruleId, severity, path, message }));
}
