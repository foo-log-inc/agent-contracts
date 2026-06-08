import { z } from "zod";

/**
 * Zod schema for a handoff type definition.
 *
 * `schema` holds a JSON Schema object describing the full message structure
 * for this handoff type. It may use `allOf` to compose shared fragments
 * (e.g., from `components.schemas`) with type-specific properties.
 *
 * Feature #134 — invocation-common structured fields:
 * `target_agent` and `workflow_phase` are optional structured metadata fields
 * that are rendered as `$tags` in the handoff payload envelope, enabling
 * downstream observability consumers to route/filter handoff events.
 */
export const HandoffTypeSchema = z
  .object({
    version: z.number(),
    description: z.string().optional(),
    schema: z.record(z.string(), z.any()),
    example: z.record(z.string(), z.any()).optional(),
    /** Structured tag: the agent role this handoff targets. */
    target_agent: z.string().optional(),
    /** Structured tag: the workflow phase this handoff belongs to. */
    workflow_phase: z.string().optional(),
  })
  .passthrough();
export type HandoffType = z.infer<typeof HandoffTypeSchema>;
