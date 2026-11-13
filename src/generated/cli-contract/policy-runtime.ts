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
  idempotency_key?: string;
  idempotent_note?: string;
}

interface EffectRead {
  target: string;
  description?: string;
}

interface NetworkEffect {
  description?: string;
  domains?: readonly string[];
  idempotent?: boolean;
  idempotency_key?: string;
  idempotent_note?: string;
}

// reads / writes are either artifact slot names or descriptive objects.
interface Effects {
  risk_level?: RiskLevel;
  reads?: readonly string[] | readonly EffectRead[];
  writes?: readonly string[] | readonly EffectWrite[];
  network?: NetworkEffect | boolean;
  execution_mode?: ExecutionMode;
  requires_confirmation?: boolean;
}

interface FileContract {
  mode: "read" | "write" | "append" | "readWrite";
}

interface Option {
  name: string;
  schema?: { type?: string | readonly string[]; [key: string]: unknown };
  file?: FileContract;
  effects?: Effects;
  repeatable?: boolean;
}

interface EnvVar {
  sensitive?: boolean;
}

/** The parts of a command's contract its policy is derived from. */
export interface CommandPolicyDefinition {
  effects?: Effects;
  options?: readonly Option[];
  env?: Readonly<Record<string, EnvVar>>;
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
      idempotency_key?: string;
      idempotent_note?: string;
      source: string;
    };

export interface DerivedNetworkEffect {
  description?: string;
  domains?: string[];
  idempotent?: boolean;
  idempotency_key?: string;
  idempotent_note?: string;
  source: string;
}

export interface DerivedPolicy {
  risk_level: RiskLevel;
  requires_confirmation: boolean;
  idempotent: boolean;
  side_effects: string[];
  reads: DerivedReadEffect[];
  writes: DerivedWriteEffect[];
  network?: DerivedNetworkEffect[];
  execution_mode?: ExecutionMode;
  requires_secrets?: string[];
}

export interface IntrospectionResult {
  command: string;
  active_options: string[];
  policy: DerivedPolicy;
}

export interface OptionInput {
  value: unknown;
  specified: boolean;
}

export interface PolicyDerivationInput {
  command_id: string;
  command_effects?: Effects;
  options: Record<
    string,
    OptionInput & { definition: Option }
  >;
  env?: Readonly<Record<string, EnvVar>>;
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

// ─── Semantic Effects ──────────────────────────────────────────

// A slot reference is the slot's name; it is the target it reads or writes.
function semanticRead(r: string | EffectRead, source: string): DerivedReadEffect {
  const read = typeof r === "string" ? { target: r } : r;
  return { kind: "semantic", target: read.target, description: read.description, source };
}

function semanticWrite(w: string | EffectWrite, source: string): DerivedWriteEffect {
  const write: EffectWrite = typeof w === "string" ? { target: w } : w;
  return {
    kind: "semantic",
    target: write.target,
    description: write.description,
    overwrite: write.overwrite,
    destructive: write.destructive,
    ...(write.idempotent !== undefined ? { idempotent: write.idempotent } : {}),
    ...(write.idempotency_key ? { idempotency_key: write.idempotency_key } : {}),
    ...(write.idempotent_note ? { idempotent_note: write.idempotent_note } : {}),
    source,
  };
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

  // Every derived write, and only a write, puts file_write among the side effects.
  const addWrite = (write: DerivedWriteEffect): void => {
    sideEffects.add("file_write");
    writes.push(write);
  };

  if (input.command_effects) {
    const ce = input.command_effects;
    riskLevels.push(ce.risk_level ?? "low");

    if (ce.writes) {
      for (const w of ce.writes) {
        addWrite(semanticWrite(w, `command:${input.command_id}`));
      }
    }

    if (ce.reads) {
      for (const r of ce.reads) {
        reads.push(semanticRead(r, `command:${input.command_id}`));
      }
    }

    if (ce.network) {
      sideEffects.add("network");
      if (typeof ce.network === "object") {
        networkEffects.push({
          ...(ce.network.description ? { description: ce.network.description } : {}),
          ...(ce.network.domains ? { domains: [...ce.network.domains] } : {}),
          ...(ce.network.idempotent !== undefined ? { idempotent: ce.network.idempotent } : {}),
          ...(ce.network.idempotency_key ? { idempotency_key: ce.network.idempotency_key } : {}),
          ...(ce.network.idempotent_note ? { idempotent_note: ce.network.idempotent_note } : {}),
          source: `command:${input.command_id}`,
        });
      }
    }

    if (ce.execution_mode) {
      executionMode = ce.execution_mode;
    }

    if (ce.requires_confirmation !== undefined) {
      explicitConfirmation = ce.requires_confirmation;
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
        addWrite({
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
      riskLevels.push(eff.risk_level ?? "low");

      if (eff.writes) {
        for (const w of eff.writes) {
          addWrite(semanticWrite(w, `option:${optName}`));
        }
      }

      if (eff.reads) {
        for (const r of eff.reads) {
          reads.push(semanticRead(r, `option:${optName}`));
        }
      }

      if (eff.network) {
        sideEffects.add("network");
        if (typeof eff.network === "object") {
          networkEffects.push({
            ...(eff.network.description ? { description: eff.network.description } : {}),
            ...(eff.network.domains ? { domains: [...eff.network.domains] } : {}),
            ...(eff.network.idempotent !== undefined ? { idempotent: eff.network.idempotent } : {}),
            ...(eff.network.idempotency_key ? { idempotency_key: eff.network.idempotency_key } : {}),
            ...(eff.network.idempotent_note ? { idempotent_note: eff.network.idempotent_note } : {}),
            source: `option:${optName}`,
          });
        }
      }

      if (eff.execution_mode && !executionMode) {
        executionMode = eff.execution_mode;
      }

      if (eff.requires_confirmation !== undefined && explicitConfirmation === undefined) {
        explicitConfirmation = eff.requires_confirmation;
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
    risk_level: finalRiskLevel,
    requires_confirmation: requiresConfirmation,
    idempotent,
    side_effects: [...sideEffects],
    reads,
    writes,
    ...(networkEffects.length > 0 ? { network: networkEffects } : {}),
    ...(executionMode ? { execution_mode: executionMode } : {}),
    ...(requiresSecrets ? { requires_secrets: requiresSecrets } : {}),
  };
}

// ─── Introspection ─────────────────────────────────────────────

/**
 * Joins the `-`-separated words of a name in camelCase, the way commander
 * names the key it keeps a `--<name>` option's value under (`dry-run` →
 * `dryRun`).
 */
export function camelCase(name: string): string {
  return name
    .split("-")
    .map((word, i) => (i === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join("");
}

/** Derives a command's policy from the option values commander parsed for it. */
export function introspectCommand(
  command_id: string,
  definition: CommandPolicyDefinition,
  optionValues: Record<string, unknown>,
): IntrospectionResult {
  const options: PolicyDerivationInput["options"] = {};
  const active_options: string[] = [];

  for (const opt of definition.options ?? []) {
    const key = camelCase(opt.name);
    const value = optionValues[key];
    const specified = key in optionValues && value !== undefined;
    options[opt.name] = { value, specified, definition: opt };
    if (isOptionActive(opt, value, specified)) {
      active_options.push(opt.name);
    }
  }

  const policy = derivePolicy({
    command_id,
    command_effects: definition.effects,
    options,
    env: definition.env,
  });

  return { command: command_id, active_options, policy };
}
