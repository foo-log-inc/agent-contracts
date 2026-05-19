import type { Dsl } from "../schema/index.js";
import type { DimensionResult, ScoreResult } from "./types.js";

function pct(n: number, d: number): number {
  return d === 0 ? 100 : Math.round((n / d) * 100);
}

function artifactValidationCoverage(dsl: Dsl): DimensionResult {
  const entries = Object.entries(dsl.artifacts);
  const total = entries.length;
  const covered = entries.filter(
    ([, a]) => a.required_validations.length > 0,
  ).length;
  const missing = entries
    .filter(([, a]) => a.required_validations.length === 0)
    .map(([id]) => id);

  return {
    id: "artifact-validation-coverage",
    label: "Artifact validation coverage",
    score: covered,
    total,
    percent: pct(covered, total),
    weight: 3,
    recommendations:
      missing.length > 0
        ? [`${missing.length} artifacts missing required_validations: ${missing.join(", ")}`]
        : [],
  };
}

function taskValidationCoverage(dsl: Dsl): DimensionResult {
  const entries = Object.entries(dsl.tasks);
  const total = entries.length;
  const covered = entries.filter(([, t]) => t.validations.length > 0).length;
  const missing = entries
    .filter(([, t]) => t.validations.length === 0)
    .map(([id]) => id);

  return {
    id: "task-validation-coverage",
    label: "Task validation coverage",
    score: covered,
    total,
    percent: pct(covered, total),
    weight: 3,
    recommendations:
      missing.length > 0
        ? [`${missing.length} tasks missing validations: ${missing.join(", ")}`]
        : [],
  };
}

function guardrailPolicyCoverage(dsl: Dsl): DimensionResult {
  const guardrailIds = Object.keys(dsl.guardrails);
  const total = guardrailIds.length;

  const referenced = new Set<string>();
  for (const policy of Object.values(dsl.guardrail_policies)) {
    for (const rule of policy.rules) {
      referenced.add(rule.guardrail);
    }
  }

  const covered = guardrailIds.filter((id) => referenced.has(id)).length;
  const missing = guardrailIds.filter((id) => !referenced.has(id));

  return {
    id: "guardrail-policy-coverage",
    label: "Guardrail policy coverage",
    score: covered,
    total,
    percent: pct(covered, total),
    weight: 2,
    recommendations:
      missing.length > 0
        ? [`${missing.length} guardrails not in any policy: ${missing.join(", ")}`]
        : [],
  };
}

function workflowValidationIntegration(dsl: Dsl): DimensionResult {
  const blockingValidations = Object.entries(dsl.validations).filter(
    ([, v]) => v.blocking,
  );
  const total = blockingValidations.length;

  const referenced = new Set<string>();
  for (const wf of Object.values(dsl.workflow)) {
    for (const step of wf.steps) {
      if (step.type === "validation") {
        referenced.add(step.validation);
      }
    }
  }
  for (const task of Object.values(dsl.tasks)) {
    for (const valId of task.validations) {
      referenced.add(valId);
    }
  }

  const covered = blockingValidations.filter(([id]) =>
    referenced.has(id),
  ).length;
  const missing = blockingValidations
    .filter(([id]) => !referenced.has(id))
    .map(([id]) => id);

  return {
    id: "workflow-validation-integration",
    label: "Workflow validation integration",
    score: covered,
    total,
    percent: pct(covered, total),
    weight: 3,
    recommendations:
      missing.length > 0
        ? [`${missing.length} blocking validations not wired: ${missing.join(", ")}`]
        : [],
  };
}

const OPTIONAL_ENTITY_FIELDS: Record<string, { section: string; fields: string[] }> = {
  agents: {
    section: "agents",
    fields: ["responsibilities", "constraints", "rules"],
  },
  tasks: {
    section: "tasks",
    fields: ["description", "responsibilities", "execution_steps", "completion_criteria"],
  },
  artifacts: {
    section: "artifacts",
    fields: ["description", "visibility"],
  },
  tools: {
    section: "tools",
    fields: ["description", "commands"],
  },
  workflow: {
    section: "workflow",
    fields: ["description", "trigger", "entry_conditions"],
  },
  guardrails: {
    section: "guardrails",
    fields: ["rationale", "tags"],
  },
};

function hasNonEmpty(obj: Record<string, unknown>, field: string): boolean {
  const val = obj[field];
  if (val === undefined || val === null) return false;
  if (typeof val === "string") return val.length > 0;
  if (Array.isArray(val)) return val.length > 0;
  return true;
}

function schemaCompleteness(dsl: Dsl): DimensionResult {
  let totalSlots = 0;
  let filledSlots = 0;
  const lowSections: string[] = [];

  for (const [sectionKey, meta] of Object.entries(OPTIONAL_ENTITY_FIELDS)) {
    const entities = (dsl as Record<string, Record<string, Record<string, unknown>>>)[
      meta.section
    ];
    if (!entities) continue;

    let sectionTotal = 0;
    let sectionFilled = 0;

    for (const entity of Object.values(entities)) {
      for (const field of meta.fields) {
        sectionTotal++;
        totalSlots++;
        if (hasNonEmpty(entity, field)) {
          sectionFilled++;
          filledSlots++;
        }
      }
    }

    if (sectionTotal > 0 && pct(sectionFilled, sectionTotal) < 50) {
      lowSections.push(sectionKey);
    }
  }

  return {
    id: "schema-completeness",
    label: "Schema completeness",
    score: filledSlots,
    total: totalSlots,
    percent: pct(filledSlots, totalSlots),
    weight: 1,
    recommendations:
      lowSections.length > 0
        ? [`Low optional field coverage in: ${lowSections.join(", ")}`]
        : [],
  };
}


function entityGuardrailCoverage(dsl: Dsl): DimensionResult {
  const entitySections: Array<{ name: string; entities: Record<string, { guardrails?: string[] }> }> = [
    { name: "agents", entities: dsl.agents },
    { name: "tasks", entities: dsl.tasks },
    { name: "tools", entities: dsl.tools },
    { name: "artifacts", entities: dsl.artifacts },
  ];

  const scopeBindings: Record<string, Set<string>> = {
    agents: new Set<string>(),
    tasks: new Set<string>(),
    tools: new Set<string>(),
    artifacts: new Set<string>(),
  };
  for (const guardrail of Object.values(dsl.guardrails)) {
    for (const key of Object.keys(scopeBindings)) {
      const ids = guardrail.scope[key as keyof typeof guardrail.scope] as string[] | undefined;
      if (ids) {
        for (const id of ids) scopeBindings[key].add(id);
      }
    }
  }

  let total = 0;
  let covered = 0;
  const missing: string[] = [];

  for (const { name, entities } of entitySections) {
    for (const [entityId, entity] of Object.entries(entities)) {
      total++;
      const hasEntitySide = (entity.guardrails ?? []).length > 0;
      const hasScopeSide = scopeBindings[name].has(entityId);
      if (hasEntitySide || hasScopeSide) {
        covered++;
      } else {
        missing.push(`${name}.${entityId}`);
      }
    }
  }

  return {
    id: "entity-guardrail-coverage",
    label: "Entity guardrail coverage",
    score: covered,
    total,
    percent: pct(covered, total),
    weight: 1,
    recommendations:
      missing.length > 0
        ? [`${missing.length} entities without guardrails: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? `, ... (${missing.length - 5} more)` : ""}`]
        : [],
  };
}

function guardrailScopeResolution(dsl: Dsl): DimensionResult {
  let totalRefs = 0;
  let resolvedRefs = 0;
  const unresolved: string[] = [];

  const sectionMap: Record<string, Record<string, unknown>> = {
    agents: dsl.agents,
    tasks: dsl.tasks,
    tools: dsl.tools,
    artifacts: dsl.artifacts,
    workflows: dsl.workflow,
  };

  for (const [guardrailId, guardrail] of Object.entries(dsl.guardrails)) {
    const scope = guardrail.scope;
    for (const [scopeKey, entityIds] of Object.entries(scope)) {
      if (!Array.isArray(entityIds)) continue;
      const section = sectionMap[scopeKey];
      if (!section) continue;

      for (const entityId of entityIds) {
        totalRefs++;
        if (section[entityId]) {
          resolvedRefs++;
        } else {
          unresolved.push(`${guardrailId}.scope.${scopeKey}: ${entityId}`);
        }
      }
    }
  }

  return {
    id: "guardrail-scope-resolution",
    label: "Guardrail scope resolution",
    score: resolvedRefs,
    total: totalRefs,
    percent: pct(resolvedRefs, totalRefs),
    weight: 2,
    recommendations:
      unresolved.length > 0
        ? [`${unresolved.length} unresolved scope refs: ${unresolved.join(", ")}`]
        : [],
  };
}

export function score(dsl: Dsl): ScoreResult {
  const dimensions = [
    artifactValidationCoverage(dsl),
    taskValidationCoverage(dsl),
    guardrailPolicyCoverage(dsl),
    workflowValidationIntegration(dsl),
    schemaCompleteness(dsl),
    guardrailScopeResolution(dsl),
    entityGuardrailCoverage(dsl),
  ];

  const totalWeight = dimensions.reduce((s, d) => s + d.weight, 0);
  const weightedSum = dimensions.reduce(
    (s, d) => s + d.percent * d.weight,
    0,
  );
  const overall = totalWeight === 0 ? 100 : Math.round(weightedSum / totalWeight);

  return { overall, dimensions };
}
