import { z } from "zod";

export const CommandSchema = z.object({
  command: z.string(),
  category: z.string(),
  reads: z.array(z.string()).default([]),
  writes: z.array(z.string()).default([]),
  purpose: z.string().optional(),
});
export type Command = z.infer<typeof CommandSchema>;

export const ToolSchema = z
  .object({
    kind: z.string().optional(),
    extends: z.string().optional(),
    command: z.string().optional(),
    description: z.string().optional(),
    input_artifacts: z.array(z.string()).default([]),
    output_artifacts: z.array(z.string()).default([]),
    invokable_by: z.array(z.string()).default([]),
    cli_contract: z.string().optional(),
    component_contract: z.string().optional(),
    artifact_bindings: z.record(z.string(), z.string()).default({}),
    side_effects: z.array(z.string()).default([]),
    commands: z.array(CommandSchema).default([]),
    guardrails: z.array(z.string()).optional(),
  })
  .passthrough();
export type Tool = z.infer<typeof ToolSchema>;
