import { z } from "zod";

export const GuardrailScopeSchema = z
  .object({
    agents: z.array(z.string()).optional(),
    tasks: z.array(z.string()).optional(),
    tools: z.array(z.string()).optional(),
    artifacts: z.array(z.string()).optional(),
    workflows: z.array(z.string()).optional(),
  })
  .passthrough();
export type GuardrailScope = z.infer<typeof GuardrailScopeSchema>;

export const GuardrailSchema = z
  .object({
    description: z.string(),
    scope: GuardrailScopeSchema,
    rationale: z.string().optional(),
    tags: z.array(z.string()).default([]),
    exemptions: z.array(z.string()).optional(),
  })
  .passthrough();
export type Guardrail = z.infer<typeof GuardrailSchema>;

export const GuardrailPolicyRuleEscalationSchema = z
  .object({
    target: z.string(),
    condition: z.string().optional(),
  })
  .passthrough();
export type GuardrailPolicyRuleEscalation = z.infer<
  typeof GuardrailPolicyRuleEscalationSchema
>;

export const ActionEnum = z.enum(["block", "warn", "shadow", "info"]);
export type ActionValue = z.infer<typeof ActionEnum>;

export const ConditionalActionSchema = z.object({
  default: ActionEnum,
  when: z.record(z.string(), ActionEnum),
});
export type ConditionalAction = z.infer<typeof ConditionalActionSchema>;

export const ActionSchema = z.union([ActionEnum, ConditionalActionSchema]);
export type Action = z.infer<typeof ActionSchema>;

export const GuardrailPolicyRuleSchema = z
  .object({
    guardrail: z.string(),
    severity: z.enum(["critical", "mandatory", "warning", "info"]),
    action: ActionSchema,
    allow_override: z.boolean().default(false),
    override_requires: z.array(z.string()).optional(),
    escalation: GuardrailPolicyRuleEscalationSchema.optional(),
  })
  .passthrough();
export type GuardrailPolicyRule = z.infer<typeof GuardrailPolicyRuleSchema>;

export const GuardrailPolicySchema = z
  .object({
    description: z.string().optional(),
    rules: z.array(GuardrailPolicyRuleSchema),
  })
  .passthrough();
export type GuardrailPolicy = z.infer<typeof GuardrailPolicySchema>;
