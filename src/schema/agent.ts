import { z } from "zod";

export const SectionSchema = z
  .object({
    title: z.string(),
    content: z.string().optional(),
    list: z
      .enum(["agents", "workflow", "validations", "guardrails"])
      .optional(),
  })
  .passthrough();
export type Section = z.infer<typeof SectionSchema>;

export const RuleSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    description: z.string(),
    severity: z.enum(["mandatory", "recommended", "optional"]),
    detection_method: z.string().optional(),
    escalation: z.string().optional(),
    ref: z.string().optional(),
  })
  .passthrough();
export type Rule = z.infer<typeof RuleSchema>;

export const EscalationCriterionSchema = z
  .object({
    condition: z.string(),
    action: z.enum([
      "stop_and_report",
      "report_to_architect",
      "wait_for_approval",
    ]),
  })
  .passthrough();
export type EscalationCriterion = z.infer<typeof EscalationCriterionSchema>;

export const PrerequisiteSchema = z
  .object({
    action: z.enum(["read", "execute"]),
    target: z.string(),
    required: z.boolean(),
  })
  .passthrough();
export type Prerequisite = z.infer<typeof PrerequisiteSchema>;

export const MemoryCapabilitySchema = z.object({
  resumable: z.boolean().optional(),
  ref_required: z.boolean().optional(),
  emits_memory_ref: z.boolean().optional(),
});
export type MemoryCapability = z.infer<typeof MemoryCapabilitySchema>;

export const AgentSchema = z
  .object({
    role_name: z.string(),
    purpose: z.string(),
    own_artifacts: z.array(z.string()).default([]),
    can_read_artifacts: z.array(z.string()).default([]),
    can_write_artifacts: z.array(z.string()).default([]),
    can_execute_tools: z.array(z.string()).default([]),
    can_perform_validations: z.array(z.string()).default([]),
    can_invoke_agents: z.array(z.string()).default([]),
    can_return_handoffs: z.array(z.string()).default([]),
    dispatch_only: z.boolean().optional(),
    mode: z.enum(["read-only", "read-write"]).optional(),
    responsibilities: z.array(z.string()).optional(),
    constraints: z.array(z.string()).optional(),
    rules: z.array(RuleSchema).optional(),
    anti_patterns: z.array(z.string()).optional(),
    escalation_criteria: z.array(EscalationCriterionSchema).optional(),
    sections: z.array(SectionSchema).optional(),
    prerequisites: z.array(PrerequisiteSchema).optional(),
    guardrails: z.array(z.string()).optional(),
    memory: MemoryCapabilitySchema.optional(),
  })
  .passthrough();
export type Agent = z.infer<typeof AgentSchema>;
