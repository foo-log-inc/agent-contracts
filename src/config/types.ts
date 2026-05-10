import { z } from "zod";

export {
  CONTEXT_TYPES,
  ContextTypeSchema,
  ITERABLE_CONTEXT_TYPES,
  type ContextType,
} from "../schema/context-type.js";

import { ContextTypeSchema, type ContextType } from "../schema/context-type.js";

export const RenderTargetSchema = z
  .object({
    template: z.string(),
    context: ContextTypeSchema,
    output: z.string(),
    include: z.array(z.string()).optional(),
    exclude: z.array(z.string()).optional(),
    skip_empty: z.boolean().optional(),
  })
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

export type RenderTarget = z.infer<typeof RenderTargetSchema>;

export const TeamConfigSchema = z.object({
  dsl: z.string().optional(),
  bindings: z.array(z.string()).default([]),
  vars: z.record(z.string(), z.string()).optional(),
  paths: z.record(z.string(), z.string()).optional(),
  active_guardrail_policy: z.string().optional(),
  interface_output: z.string().optional(),
});

export type TeamConfig = z.infer<typeof TeamConfigSchema>;

export const AuditConfigSchema = z
  .object({
    adapter: z.string().optional(),
    model: z.string().optional(),
    temperature: z.number().min(0).max(2).optional(),
    cache_dir: z.string().optional(),
  })
  .optional();

export type AuditConfig = z.infer<typeof AuditConfigSchema>;

export const AgentContractsConfigSchema = z
  .object({
    dsl: z.string().optional(),
    vars: z.record(z.string(), z.string()).optional(),
    renders: z.array(RenderTargetSchema).default([]),
    bindings: z.array(z.string()).default([]),
    active_guardrail_policy: z.string().optional(),
    paths: z.record(z.string(), z.string()).optional(),
    teams: z.record(z.string(), TeamConfigSchema).optional(),
    audit: AuditConfigSchema,
  })
  .superRefine((data, ctx) => {
    if (data.dsl !== undefined && data.teams !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "dsl and teams are mutually exclusive",
        path: ["teams"],
      });
      return;
    }
    if (data.dsl === undefined && data.teams === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Either dsl or teams must be specified",
        path: [],
      });
      return;
    }
    if (data.teams) {
      for (const [key, team] of Object.entries(data.teams)) {
        if (key === "_defaults") continue;
        if (team.dsl === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Team "${key}" must specify dsl`,
            path: ["teams", key, "dsl"],
          });
        }
      }
    }
  });

export type AgentContractsConfig = z.infer<typeof AgentContractsConfigSchema>;

export interface ResolvedRenderTarget {
  template: string;
  context: ContextType;
  output: string;
  include?: string[];
  exclude?: string[];
  skip_empty?: boolean;
}

export interface ResolvedTeamConfig {
  dsl: string;
  vars?: Record<string, string>;
  bindings: string[];
  activeGuardrailPolicy?: string;
  paths?: Record<string, string>;
  interfaceOutput?: string;
}

export interface ResolvedConfig {
  dsl: string;
  vars?: Record<string, string>;
  renders: ResolvedRenderTarget[];
  configDir: string;
  bindings: string[];
  activeGuardrailPolicy?: string;
  paths?: Record<string, string>;
  teams?: Record<string, ResolvedTeamConfig>;
}
