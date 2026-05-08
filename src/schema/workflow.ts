import { z } from "zod";
import { SectionSchema } from "./agent.js";

const RetrySchema = z.object({
  condition: z.string(),
  fix_task: z.string(),
  revalidate_task: z.string().optional(),
});
export type Retry = z.infer<typeof RetrySchema>;

const ExternalParticipantSchema = z.object({
  id: z.string(),
  kind: z.enum(["actor", "participant"]),
  label: z.string(),
  description: z.string().optional(),
});
export type ExternalParticipant = z.infer<typeof ExternalParticipantSchema>;

const WorkflowDelegateStepSchema = z
  .object({
    type: z.literal("delegate"),
    description: z.string().optional(),
    task: z.string(),
    from_agent: z.string(),
    group: z.string().optional(),
    max_retries: z.number().int().min(0).optional(),
    max_follow_ups: z.number().int().min(0).optional(),
    retry: RetrySchema.optional(),
  })
  .passthrough();

const WorkflowGateStepSchema = z
  .object({
    type: z.literal("gate"),
    description: z.string().optional(),
    gate_kind: z.string(),
    group: z.string().optional(),
  })
  .passthrough();

/** @deprecated Use `delegate` for task execution, `gate` for review steps */
const WorkflowHandoffStepSchema = z
  .object({
    type: z.literal("handoff"),
    description: z.string().optional(),
    handoff_kind: z.string(),
    task: z.string().optional(),
    from_agent: z.string().optional(),
    group: z.string().optional(),
    retry: RetrySchema.optional(),
  })
  .passthrough();

/** @deprecated Use task.validations instead */
const WorkflowValidationStepSchema = z
  .object({
    type: z.literal("validation"),
    description: z.string().optional(),
    validation: z.string(),
    group: z.string().optional(),
  })
  .passthrough();

const WorkflowDecisionStepSchema = z
  .object({
    type: z.literal("decision"),
    description: z.string().optional(),
    /** @deprecated Use `routing_key` instead. `on` is kept for backward compatibility. */
    on: z.string().optional(),
    routing_key: z.string().optional(),
    branches: z.record(z.string(), z.array(z.string())),
    group: z.string().optional(),
  })
  .passthrough();

const WorkflowTeamTaskStepSchema = z
  .object({
    type: z.literal("team_task"),
    description: z.string().optional(),
    to_team: z.string(),
    workflow: z.string(),
    handoff: z.string(),
    expects: z.string(),
    group: z.string().optional(),
  })
  .passthrough();

export const WorkflowStepSchema = z.discriminatedUnion("type", [
  WorkflowDelegateStepSchema,
  WorkflowGateStepSchema,
  WorkflowHandoffStepSchema,
  WorkflowValidationStepSchema,
  WorkflowDecisionStepSchema,
  WorkflowTeamTaskStepSchema,
]);
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;

export const WorkflowSchema = z
  .object({
    description: z.string().optional(),
    entry_conditions: z.array(z.string()).default([]),
    trigger: z.string().optional(),
    steps: z.array(WorkflowStepSchema),
    sections: z.array(SectionSchema).optional(),
    external_participants: z.array(ExternalParticipantSchema).default([]),
  })
  .passthrough();
export type Workflow = z.infer<typeof WorkflowSchema>;
