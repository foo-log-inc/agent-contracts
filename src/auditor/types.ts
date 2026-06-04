export type AuditType = "render" | "dsl" | "prompt" | "extensions";

export type OutputFormat = "text" | "json" | "markdown";

export interface AuditOptions {
  auditType: AuditType;
  format: OutputFormat;
  scope?: string;
  showPrompt?: boolean;
  adapter?: string;
  model?: string;
  team?: string;
  logFile?: string;
}

export interface AuditConfig {
  adapter?: string;
  model?: string;
  temperature?: number;
  cache_dir?: string;
}
