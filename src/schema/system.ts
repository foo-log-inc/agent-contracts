import { z } from "zod";
import { SectionSchema } from "./agent.js";

export const VersionLiteralSchema = z.literal(1);
export type VersionLiteral = z.infer<typeof VersionLiteralSchema>;

export const ExtendsSchema = z.string().optional();
export type Extends = z.infer<typeof ExtendsSchema>;

export const ContextLoadingSchema = z
  .record(z.string(), z.array(z.string()))
  .optional();
export type ContextLoading = z.infer<typeof ContextLoadingSchema>;

export const SystemSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    default_workflow_order: z.array(z.string()),
    sections: z.array(SectionSchema).optional(),
    context_loading: ContextLoadingSchema,
  })
  .passthrough();
export type System = z.infer<typeof SystemSchema>;
