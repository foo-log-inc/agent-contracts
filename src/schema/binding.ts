import { z } from "zod";
import { ContextTypeSchema } from "./context-type.js";

const CommandRegexMatcherSchema = z
  .object({
    type: z.literal("command_regex"),
    pattern: z.string(),
  })
  .passthrough();

const ContentRegexMatcherSchema = z
  .object({
    type: z.literal("content_regex"),
    pattern: z.string(),
    file_glob: z.string().optional(),
    exclude_glob: z.string().optional(),
  })
  .passthrough();

const FileGlobMatcherSchema = z
  .object({
    type: z.literal("file_glob"),
    pattern: z.string(),
    exclude_glob: z.string().optional(),
  })
  .passthrough();

export const MatcherSchema = z.discriminatedUnion("type", [
  CommandRegexMatcherSchema,
  ContentRegexMatcherSchema,
  FileGlobMatcherSchema,
]);
export type Matcher = z.infer<typeof MatcherSchema>;

export const CheckSchema = z
  .object({
    matcher: MatcherSchema.optional(),
    script: z.string().optional(),
    message: z.string().optional(),
  })
  .passthrough();
export type Check = z.infer<typeof CheckSchema>;

export const BindingOutputSchema = z
  .object({
    target: z.string(),
    template: z.string().optional(),
    inline_template: z.string().optional(),
    source: z.string().optional(),
    mode: z.enum(["write", "patch"]).default("write"),
    /** File format — defaults to value inferred from template/target file extension */
    format: z.enum(["json", "yaml", "bash", "text"]).optional(),
    /** Merge strategy for patch mode */
    patch_strategy: z.enum(["deep_merge", "array_append", "section_append"]).optional(),
    /** Key field used to deduplicate array elements by identity (makes generate idempotent) */
    array_merge_key: z.string().optional(),
    group_by: z.string().optional(),
    executable: z.boolean().optional(),
    skip_empty: z.boolean().optional(),
  })
  .passthrough()
  .refine(
    (data) => {
      const count = [data.template, data.inline_template, data.source]
        .filter(Boolean).length;
      return count === 1 || count === 0;
    },
    { message: "Only one of template, inline_template, or source may be specified" },
  );
export type BindingOutput = z.infer<typeof BindingOutputSchema>;

export const ReportingSchema = z
  .object({
    commands: z.record(z.string(), z.string()),
    fail_open: z.boolean().default(true),
    timeout_ms: z.number().default(5000),
  })
  .passthrough();
export type Reporting = z.infer<typeof ReportingSchema>;

const GuardrailImplSchema = z.object({
  checks: z.array(CheckSchema),
});

export const BindingRenderTargetSchema = z
  .object({
    template: z.string().optional(),
    inline_template: z.string().optional(),
    context: ContextTypeSchema,
    output: z.string(),
    include: z.array(z.string()).optional(),
    exclude: z.array(z.string()).optional(),
    skip_empty: z.boolean().optional(),
    executable: z.boolean().optional(),
  })
  .passthrough()
  .refine(
    (data) => {
      const count = [data.template, data.inline_template].filter(Boolean).length;
      return count === 1;
    },
    { message: "Exactly one of template or inline_template must be specified" },
  )
  .refine(
    (data) => !(data.include && data.exclude),
    { message: "include and exclude are mutually exclusive" },
  )
  .refine(
    (data) => {
      if (data.context === "system" && (data.include || data.exclude)) {
        return false;
      }
      return true;
    },
    { message: "include/exclude cannot be used with context: system" },
  );
export type BindingRenderTarget = z.infer<typeof BindingRenderTargetSchema>;

// ── Feature #133: event_mapping ─────────────────────────────────────────────

/**
 * A single observability span declaration within an event_mapping rule.
 * `axis` identifies the signal axis (e.g. "trace", "metric", "log").
 * `lifecycle` is the lifecycle phase ("start" | "end" | "point", etc.).
 * `each` is an optional iteration expression (template string).
 * `attributes` are template-string key/value pairs rendered at runtime.
 */
export const EventMappingSpanSchema = z
  .object({
    axis: z.string(),
    name: z.string(),
    lifecycle: z.string(),
    condition: z.string().optional(),
    each: z.string().optional(),
    attributes: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();
export type EventMappingSpan = z.infer<typeof EventMappingSpanSchema>;

/**
 * A causal link between two spans within an event_mapping rule.
 * `type` is the link kind (e.g. "follows_from", "child_of").
 */
export const EventMappingLinkSchema = z
  .object({
    type: z.string(),
    from: z.string(),
    to: z.string(),
    condition: z.string().optional(),
    attributes: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();
export type EventMappingLink = z.infer<typeof EventMappingLinkSchema>;

/**
 * Rule associated with a single hook event name.
 */
export const EventMappingRuleSchema = z
  .object({
    spans: z.array(EventMappingSpanSchema).optional(),
    links: z.array(EventMappingLinkSchema).optional(),
  })
  .passthrough();
export type EventMappingRule = z.infer<typeof EventMappingRuleSchema>;

// ────────────────────────────────────────────────────────────────────────────

export const SoftwareBindingSchema = z
  .object({
    software: z.string(),
    version: z.literal(1),
    extends: z.string().optional(),
    guardrail_impl: z.record(z.string(), GuardrailImplSchema).optional(),
    outputs: z.record(z.string(), BindingOutputSchema).optional(),
    renders: z.array(BindingRenderTargetSchema).optional(),
    reporting: ReportingSchema.optional(),
    /**
     * Declarative event mapping: maps hook event names to span/link rules.
     * Used by `builtin:event-mapping` and related builtin template generators.
     */
    event_mapping: z.record(z.string(), EventMappingRuleSchema).optional(),
  })
  .passthrough();
export type SoftwareBinding = z.infer<typeof SoftwareBindingSchema>;
