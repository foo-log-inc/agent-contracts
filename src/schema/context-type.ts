import { z } from "zod";

export const CONTEXT_TYPES = [
  "agent",
  "task",
  "artifact",
  "tool",
  "validation",
  "handoff_type",
  "workflow",
  "policy",
  "guardrail",
  "guardrail_policy",
  "system",
  "navigation-index",
] as const;

export const ContextTypeSchema = z.enum(CONTEXT_TYPES);
export type ContextType = z.infer<typeof ContextTypeSchema>;

export const ITERABLE_CONTEXT_TYPES = CONTEXT_TYPES.filter(
  (t): t is Exclude<ContextType, "system" | "navigation-index"> =>
    t !== "system" && t !== "navigation-index",
);
