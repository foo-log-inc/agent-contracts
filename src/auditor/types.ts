export type AuditType = "render" | "dsl" | "prompt";

export type OutputFormat = "text" | "json" | "markdown";

export interface AuditOptions {
  auditType: AuditType;
  format: OutputFormat;
  scope?: string;
  dryRun: boolean;
  adapter?: string;
  model?: string;
  team?: string;
}

export interface AuditConfig {
  adapter?: string;
  model?: string;
  temperature?: number;
  cache_dir?: string;
}
