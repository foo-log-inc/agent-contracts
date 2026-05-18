// Standalone policy runtime. Copied by cli-contracts generate.
// This file is self-contained — no imports from cli-contracts internals.

// ─── Inline Type Definitions ─────────────────────────────────────

export type RiskLevel = "low" | "medium" | "high" | "critical";
export type ExecutionMode = "normal" | "long-running" | "watch" | "interactive" | "background";

interface EffectWrite {
  target: string;
  description?: string;
  overwrite?: boolean;
  destructive?: boolean;
  idempotent?: boolean;
  idempotencyKey?: string;
  idempotentNote?: string;
}

interface EffectRead {
  target: string;
  description?: string;
}

interface NetworkEffect {
  description?: string;
  domains?: string[];
  idempotent?: boolean;
  idempotencyKey?: string;
  idempotentNote?: string;
}

interface Effects {
  riskLevel?: RiskLevel;
  reads?: EffectRead[];
  writes?: EffectWrite[];
  network?: NetworkEffect | boolean;
  executionMode?: ExecutionMode;
  requiresConfirmation?: boolean;
}

interface FileContract {
  mode: "read" | "write" | "append" | "readWrite";
}

interface Option {
  name: string;
  schema?: { type?: string; [key: string]: unknown };
  file?: FileContract;
  effects?: Effects;
  repeatable?: boolean;
}

interface EnvVar {
  sensitive?: boolean;
}

// ─── Derived Policy Types ───────────────────────────────────────

export type DerivedReadEffect =
  | { kind: "option-file"; option: string; path?: string; source: string }
  | { kind: "semantic"; target: string; description?: string; source: string };

export type DerivedWriteEffect =
  | {
      kind: "option-file";
      option: string;
      path?: string;
      mode: string;
      source: string;
    }
  | {
      kind: "semantic";
      target: string;
      description?: string;
      overwrite?: boolean;
      destructive?: boolean;
      idempotent?: boolean;
      idempotencyKey?: string;
      idempotentNote?: string;
      source: string;
    };

export interface DerivedNetworkEffect {
  description?: string;
  domains?: string[];
  idempotent?: boolean;
  idempotencyKey?: string;
  idempotentNote?: string;
  source: string;
}

export interface DerivedPolicy {
  riskLevel: RiskLevel;
  requiresConfirmation: boolean;
  idempotent: boolean;
  sideEffects: string[];
  reads: DerivedReadEffect[];
  writes: DerivedWriteEffect[];
  network?: DerivedNetworkEffect[];
  executionMode?: ExecutionMode;
  requiresSecrets?: string[];
}

export interface IntrospectionResult {
  command: string;
  activeOptions: string[];
  policy: DerivedPolicy;
}

export interface OptionInput {
  value: unknown;
  specified: boolean;
}

export interface PolicyDerivationInput {
  commandId: string;
  commandEffects?: Effects;
  options: Record<
    string,
    OptionInput & { definition: Option }
  >;
  env?: Record<string, EnvVar>;
}

// ─── Risk Level Ordering ────────────────────────────────────────

const RISK_ORDER: Record<RiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

function maxRiskLevel(...levels: RiskLevel[]): RiskLevel {
  let max: RiskLevel = "low";
  for (const level of levels) {
    if (RISK_ORDER[level] > RISK_ORDER[max]) {
      max = level;
    }
  }
  return max;
}

// ─── Active Determination ───────────────────────────────────────

export function isOptionActive(
  definition: Option,
  value: unknown,
  specified: boolean,
): boolean {
  const schemaType = definition.schema?.type;

  if (schemaType === "boolean") {
    return value === true;
  }

  if (definition.repeatable) {
    return specified && Array.isArray(value) && value.length > 0;
  }

  return specified && value != null;
}

// ─── Derive Policy ─────────────────────────────────────────────

export function derivePolicy(input: PolicyDerivationInput): DerivedPolicy {
  const sideEffects = new Set<string>();
  const reads: DerivedReadEffect[] = [];
  const writes: DerivedWriteEffect[] = [];
  const networkEffects: DerivedNetworkEffect[] = [];
  const riskLevels: RiskLevel[] = [];
  let executionMode: ExecutionMode | undefined;
  let explicitConfirmation: boolean | undefined;

  if (input.commandEffects) {
    const ce = input.commandEffects;
    riskLevels.push(ce.riskLevel ?? "low");

    if (ce.writes) {
      sideEffects.add("file_write");
      for (const w of ce.writes) {
        writes.push({
          kind: "semantic",
          target: w.target,
          description: w.description,
          overwrite: w.overwrite,
          destructive: w.destructive,
          ...(w.idempotent !== undefined ? { idempotent: w.idempotent } : {}),
          ...(w.idempotencyKey ? { idempotencyKey: w.idempotencyKey } : {}),
          ...(w.idempotentNote ? { idempotentNote: w.idempotentNote } : {}),
          source: `command:${input.commandId}`,
        });
      }
    }

    if (ce.reads) {
      for (const r of ce.reads) {
        reads.push({
          kind: "semantic",
          target: r.target,
          description: r.description,
          source: `command:${input.commandId}`,
        });
      }
    }

    if (ce.network) {
      sideEffects.add("network");
      if (typeof ce.network === "object") {
        networkEffects.push({
          ...(ce.network.description ? { description: ce.network.description } : {}),
          ...(ce.network.domains ? { domains: ce.network.domains } : {}),
          ...(ce.network.idempotent !== undefined ? { idempotent: ce.network.idempotent } : {}),
          ...(ce.network.idempotencyKey ? { idempotencyKey: ce.network.idempotencyKey } : {}),
          ...(ce.network.idempotentNote ? { idempotentNote: ce.network.idempotentNote } : {}),
          source: `command:${input.commandId}`,
        });
      }
    }

    if (ce.executionMode) {
      executionMode = ce.executionMode;
    }

    if (ce.requiresConfirmation !== undefined) {
      explicitConfirmation = ce.requiresConfirmation;
    }
  }

  for (const [optName, optInput] of Object.entries(input.options)) {
    const { definition, value, specified } = optInput;
    const active = isOptionActive(definition, value, specified);
    if (!active) continue;

    if (definition.file) {
      const filePath =
        typeof value === "string" ? value : undefined;
      const mode = definition.file.mode;

      if (mode === "read" || mode === "readWrite") {
        reads.push({
          kind: "option-file",
          option: optName,
          path: filePath,
          source: `option:${optName}`,
        });
      }
      if (mode === "write" || mode === "append" || mode === "readWrite") {
        sideEffects.add("file_write");
        writes.push({
          kind: "option-file",
          option: optName,
          path: filePath,
          mode,
          source: `option:${optName}`,
        });
      }
    }

    if (definition.effects) {
      const eff = definition.effects;
      riskLevels.push(eff.riskLevel ?? "low");

      if (eff.writes) {
        sideEffects.add("file_write");
        for (const w of eff.writes) {
          writes.push({
            kind: "semantic",
            target: w.target,
            description: w.description,
            overwrite: w.overwrite,
            destructive: w.destructive,
            ...(w.idempotent !== undefined ? { idempotent: w.idempotent } : {}),
            ...(w.idempotencyKey ? { idempotencyKey: w.idempotencyKey } : {}),
            ...(w.idempotentNote ? { idempotentNote: w.idempotentNote } : {}),
            source: `option:${optName}`,
          });
        }
      }

      if (eff.reads) {
        for (const r of eff.reads) {
          reads.push({
            kind: "semantic",
            target: r.target,
            description: r.description,
            source: `option:${optName}`,
          });
        }
      }

      if (eff.network) {
        sideEffects.add("network");
        if (typeof eff.network === "object") {
          networkEffects.push({
            ...(eff.network.description ? { description: eff.network.description } : {}),
            ...(eff.network.domains ? { domains: eff.network.domains } : {}),
            ...(eff.network.idempotent !== undefined ? { idempotent: eff.network.idempotent } : {}),
            ...(eff.network.idempotencyKey ? { idempotencyKey: eff.network.idempotencyKey } : {}),
            ...(eff.network.idempotentNote ? { idempotentNote: eff.network.idempotentNote } : {}),
            source: `option:${optName}`,
          });
        }
      }

      if (eff.executionMode && !executionMode) {
        executionMode = eff.executionMode;
      }

      if (eff.requiresConfirmation !== undefined && explicitConfirmation === undefined) {
        explicitConfirmation = eff.requiresConfirmation;
      }
    }
  }

  const finalRiskLevel =
    riskLevels.length > 0 ? maxRiskLevel(...riskLevels) : "low";

  const requiresConfirmation =
    explicitConfirmation ??
    (finalRiskLevel === "high" || finalRiskLevel === "critical");

  let requiresSecrets: string[] | undefined;
  if (input.env) {
    const secrets: string[] = [];
    for (const [envName, envVar] of Object.entries(input.env)) {
      if (envVar.sensitive) {
        secrets.push(envName);
      }
    }
    if (secrets.length > 0) {
      requiresSecrets = secrets;
    }
  }

  const semanticWrites = writes.filter((w) => w.kind === "semantic");
  const idempotent =
    semanticWrites.every((w) => w.idempotent === true) &&
    networkEffects.every((n) => n.idempotent === true);

  return {
    riskLevel: finalRiskLevel,
    requiresConfirmation,
    idempotent,
    sideEffects: [...sideEffects],
    reads,
    writes,
    ...(networkEffects.length > 0 ? { network: networkEffects } : {}),
    ...(executionMode ? { executionMode } : {}),
    ...(requiresSecrets ? { requiresSecrets } : {}),
  };
}
