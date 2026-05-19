import { z } from "zod";

export const ArtifactSchema = z
  .object({
    type: z.string(),
    description: z.string().optional(),
    owner: z.string().optional(),
    producers: z.array(z.string()).default([]),
    editors: z.array(z.string()).default([]),
    consumers: z.array(z.string()).default([]),
    states: z.array(z.string()).default([]),
    required_validations: z.array(z.string()).default([]),
    visibility: z.string().optional(),
    classification: z.string().optional(),
    guardrails: z.array(z.string()).optional(),
    authority: z.enum(["canonical", "derived", "generated", "control"]).optional(),
    path_patterns: z.array(z.string()).optional(),
    exclude_patterns: z.array(z.string()).optional(),
    manual_edit: z.enum(["allowed", "discouraged", "forbidden"]).optional(),
    change_control: z.enum(["none", "approval-required", "regeneration-required"]).optional(),
  })
  .passthrough();
export type Artifact = z.infer<typeof ArtifactSchema>;
