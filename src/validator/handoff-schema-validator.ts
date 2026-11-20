import Ajv from "ajv";
import type { Dsl } from "../schema/index.js";
import type { ReferenceDiagnostic } from "./reference-resolver.js";

const ajv = new Ajv({ allErrors: true, strict: false });

/**
 * Meta-validate all `handoff_types.*.schema` entries as valid JSON Schema.
 *
 * Uses ajv's `validateSchema` to check that each schema is structurally
 * valid according to the JSON Schema specification. Returns diagnostics
 * with code `"invalid-handoff-schema"` for any violations.
 */
export function validateHandoffSchemas(dsl: Dsl): ReferenceDiagnostic[] {
  const diagnostics: ReferenceDiagnostic[] = [];

  for (const [kind, ht] of Object.entries(dsl.handoff_types)) {
    const schema = ht.schema as Record<string, unknown>;
    if (Object.keys(schema).length === 0) continue;

    const valid = ajv.validateSchema(schema);
    if (!valid && ajv.errors) {
      for (const err of ajv.errors) {
        diagnostics.push({
          path: `handoff_types.${kind}.schema${err.instancePath}`,
          message: `Invalid JSON Schema: ${err.message ?? "unknown error"}`,
          code: "invalid-handoff-schema",
          severity: "error",
        });
      }
    }
  }

  return diagnostics;
}
