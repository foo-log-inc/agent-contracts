import { z } from "zod";
import { EscalationCriterionSchema, RuleSchema, SectionSchema } from "./agent.js";

export const ExecutionStepSchema = z
  .object({
    id: z.string(),
    action: z.string(),
    description: z.string().optional(),
    required: z.boolean().optional(),
    abort_on_failure: z.boolean().optional(),
    uses_tool: z.string().optional(),
    produces_artifact: z.string().optional(),
    reads_artifact: z.string().optional(),
    validates_artifact: z.string().optional(),
    validation_kind: z.enum(["schema", "mechanical", "semantic", "approval", "provenance", "traceability", "fidelity"]).optional(),
    depends_on: z.array(z.string()).optional(),
    skip_condition: z.string().optional(),
    wait_for_approval: z.boolean().optional(),
  })
  .passthrough();
export type ExecutionStep = z.infer<typeof ExecutionStepSchema>;

export const TaskSchema = z
  .object({
    description: z.string(),
    target_agent: z.string(),
    allowed_from_agents: z.array(z.string()).default([]),
    workflow: z.string(),
    input_artifacts: z.array(z.string()),
    invocation_handoff: z.string(),
    result_handoff: z.string(),
    default_priority: z.string().optional(),
    responsibilities: z.array(z.string()).optional(),
    constraints: z.array(z.string()).optional(),
    execution_steps: z.array(ExecutionStepSchema).optional(),
    completion_criteria: z.array(z.string()).optional(),
    rules: z.array(RuleSchema).optional(),
    anti_patterns: z.array(z.string()).optional(),
    escalation_criteria: z.array(EscalationCriterionSchema).optional(),
    sections: z.array(SectionSchema).optional(),
    validations: z.array(z.string()).default([]),
    guardrails: z.array(z.string()).optional(),
  })
  .passthrough();
export type Task = z.infer<typeof TaskSchema>;
