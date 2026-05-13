import { z } from "zod";

export const ArtifactSchema = z
  .object({
    type: z.string(),
    description: z.string().optional(),
    owner: z.string(),
    producers: z.array(z.string()),
    editors: z.array(z.string()),
    consumers: z.array(z.string()),
    states: z.array(z.string()),
    required_validations: z.array(z.string()).default([]),
    visibility: z.string().optional(),
    classification: z.string().optional(),
    guardrails: z.array(z.string()).optional(),
  })
  .passthrough();
export type Artifact = z.infer<typeof ArtifactSchema>;
