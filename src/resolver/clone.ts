import { deepMergeEntities } from "./merger.js";

export class CloneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CloneError";
  }
}

type AnyRecord = Record<string, unknown>;

function isRecord(v: unknown): v is AnyRecord {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Map-type top-level DSL sections (mirrors merger.ts DSL_SECTIONS where mode === "map"). */
const MAP_SECTIONS = [
  "agents",
  "tasks",
  "artifacts",
  "tools",
  "validations",
  "handoff_types",
  "imports",
  "workflow",
  "policies",
  "guardrails",
  "guardrail_policies",
  "components",
  "extensions",
] as const;

function deepCopy<T>(value: T): T {
  return structuredClone(value);
}

function hasClone(entity: unknown): boolean {
  return isRecord(entity) && "$clone" in entity;
}

function getCloneSpec(
  entity: AnyRecord,
): { from: string; merge?: AnyRecord } {
  const clone = entity["$clone"];
  if (!isRecord(clone)) {
    throw new CloneError("Invalid $clone: expected object");
  }
  const from = clone["from"];
  if (typeof from !== "string") {
    throw new CloneError("Invalid $clone: from must be a string");
  }
  const merge = clone["merge"];
  return {
    from,
    merge: isRecord(merge) ? merge : undefined,
  };
}

function topologicalSortCloneIds(
  cloneIds: string[],
  entities: AnyRecord,
): string[] {
  const cloneSet = new Set(cloneIds);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const result: string[] = [];

  function visit(id: string): void {
    if (visited.has(id)) {
      return;
    }
    if (visiting.has(id)) {
      throw new CloneError(
        `circular reference detected involving "${id}"`,
      );
    }

    visiting.add(id);
    const spec = getCloneSpec(entities[id] as AnyRecord);
    if (cloneSet.has(spec.from)) {
      visit(spec.from);
    }
    visiting.delete(id);
    visited.add(id);
    result.push(id);
  }

  for (const id of cloneIds) {
    visit(id);
  }

  return result;
}

function resolveSectionClones(section: string, entities: AnyRecord): void {
  const cloneIds = Object.keys(entities).filter((id) =>
    hasClone(entities[id]),
  );
  if (cloneIds.length === 0) {
    return;
  }

  const sorted = topologicalSortCloneIds(cloneIds, entities);
  const resolved = new Map<string, AnyRecord>();

  for (const id of sorted) {
    const spec = getCloneSpec(entities[id] as AnyRecord);
    const fromId = spec.from;

    let baseEntity: AnyRecord;
    if (resolved.has(fromId)) {
      baseEntity = resolved.get(fromId)!;
    } else if (fromId in entities) {
      const raw = entities[fromId];
      if (hasClone(raw)) {
        throw new CloneError(
          `base "${fromId}" not found in section "${section}"`,
        );
      }
      baseEntity = raw as AnyRecord;
    } else {
      throw new CloneError(
        `base "${fromId}" not found in section "${section}"`,
      );
    }

    let copy = deepCopy(baseEntity) as AnyRecord;
    if (spec.merge !== undefined) {
      copy = deepMergeEntities(copy, spec.merge, `${section}.${id}`, true);
    }

    resolved.set(id, copy);
    entities[id] = copy;
  }
}

export function resolveClone(data: Record<string, unknown>): Record<string, unknown> {
  for (const section of MAP_SECTIONS) {
    const sectionValue = data[section];
    if (
      sectionValue === undefined ||
      sectionValue === null ||
      !isRecord(sectionValue) ||
      Array.isArray(sectionValue)
    ) {
      continue;
    }
    resolveSectionClones(section, sectionValue as AnyRecord);
  }

  return data;
}
