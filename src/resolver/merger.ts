export class MergeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MergeError";
  }
}

type AnyRecord = Record<string, unknown>;
type AnyArray = unknown[];

function isRecord(v: unknown): v is AnyRecord {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function hasOperator(obj: AnyRecord): string | null {
  const ops = ["$append", "$prepend", "$insert_after", "$replace", "$remove"];
  for (const op of ops) {
    if (op in obj) return op;
  }
  return null;
}

function findIndexByIdOrValue(arr: AnyArray, target: string): number {
  return arr.findIndex((item) => {
    if (typeof item === "string") {
      return item === target;
    }
    return isRecord(item) && (item as AnyRecord)["id"] === target;
  });
}

function applyArrayMergeOperator(
  baseArray: AnyArray,
  operatorObj: AnyRecord,
  path: string,
): AnyArray {
  const op = hasOperator(operatorObj);
  if (!op) return baseArray;

  switch (op) {
    case "$append": {
      const items = operatorObj["$append"] as AnyArray;
      return [...baseArray, ...items];
    }
    case "$prepend": {
      const items = operatorObj["$prepend"] as AnyArray;
      return [...items, ...baseArray];
    }
    case "$insert_after": {
      const spec = operatorObj["$insert_after"] as AnyRecord;
      const target = spec["target"] as string;
      const items = spec["items"] as AnyArray;
      const idx = findIndexByIdOrValue(baseArray, target);
      if (idx === -1) {
        throw new MergeError(
          `$insert_after target "${target}" not found in base at ${path}`,
        );
      }
      const result = [...baseArray];
      result.splice(idx + 1, 0, ...items);
      return result;
    }
    case "$replace": {
      return operatorObj["$replace"] as AnyArray;
    }
    case "$remove": {
      const removeList = operatorObj["$remove"] as unknown[];
      if (removeList.length === 0) {
        return baseArray;
      }

      if (typeof removeList[0] === "string") {
        const valuesToRemove = new Set(removeList as string[]);
        const result = baseArray.filter((item) => {
          if (typeof item === "string" && valuesToRemove.has(item)) {
            valuesToRemove.delete(item);
            return false;
          }
          return true;
        });
        if (valuesToRemove.size > 0) {
          throw new MergeError(
            `$remove values not found in base at ${path}: ${[...valuesToRemove].join(", ")}`,
          );
        }
        return result;
      }

      const idsToRemove = new Set(
        (removeList as AnyRecord[]).map((r) => r["id"] as string),
      );
      const result = baseArray.filter((item) => {
        if (isRecord(item) && typeof (item as AnyRecord)["id"] === "string") {
          const itemId = (item as AnyRecord)["id"] as string;
          if (idsToRemove.has(itemId)) {
            idsToRemove.delete(itemId);
            return false;
          }
        }
        return true;
      });
      if (idsToRemove.size > 0) {
        throw new MergeError(
          `$remove ids not found in base at ${path}: ${[...idsToRemove].join(", ")}`,
        );
      }
      return result;
    }
    default:
      return baseArray;
  }
}

function orderedInsertAfter(
  base: AnyRecord,
  afterKey: string,
  entries: AnyRecord,
): AnyRecord {
  const result: AnyRecord = {};
  let inserted = false;
  for (const key of Object.keys(base)) {
    result[key] = base[key];
    if (key === afterKey) {
      for (const [ek, ev] of Object.entries(entries)) {
        result[ek] = ev;
      }
      inserted = true;
    }
  }
  if (!inserted) {
    return result;
  }
  return result;
}

function applyMapMergeOperator(
  baseMap: AnyRecord,
  operatorObj: AnyRecord,
  path: string,
): AnyRecord {
  const op = hasOperator(operatorObj);
  if (!op) return baseMap;

  switch (op) {
    case "$append": {
      const entries = operatorObj["$append"] as AnyRecord;
      return { ...baseMap, ...entries };
    }
    case "$prepend": {
      const entries = operatorObj["$prepend"] as AnyRecord;
      return { ...entries, ...baseMap };
    }
    case "$insert_after": {
      const spec = operatorObj["$insert_after"] as AnyRecord;
      const afterKey = spec["after"] as string;
      const entries = spec["entries"] as AnyRecord;
      if (!(afterKey in baseMap)) {
        throw new MergeError(
          `$insert_after key "${afterKey}" not found in base at ${path}`,
        );
      }
      return orderedInsertAfter(baseMap, afterKey, entries);
    }
    case "$replace": {
      return operatorObj["$replace"] as AnyRecord;
    }
    case "$remove": {
      const keysToRemove = operatorObj["$remove"] as string[];
      const removeSet = new Set(keysToRemove);
      const missing = keysToRemove.filter((k) => !(k in baseMap));
      if (missing.length > 0) {
        throw new MergeError(
          `$remove keys not found in base at ${path}: ${missing.join(", ")}`,
        );
      }
      const result: AnyRecord = {};
      for (const [k, v] of Object.entries(baseMap)) {
        if (!removeSet.has(k)) {
          result[k] = v;
        }
      }
      return result;
    }
    default:
      return baseMap;
  }
}

export function deepMergeEntities(
  base: AnyRecord,
  project: AnyRecord,
  path: string,
  hasExtends: boolean,
): AnyRecord {
  const result = { ...base };

  for (const key of Object.keys(project)) {
    const baseVal = result[key];
    const projVal = project[key];

    if (isRecord(projVal) && hasOperator(projVal)) {
      if (!hasExtends) {
        throw new MergeError(
          `Merge operator used without extends at ${path}.${key}`,
        );
      }
      if (Array.isArray(baseVal)) {
        result[key] = applyArrayMergeOperator(baseVal, projVal, `${path}.${key}`);
      } else if (isRecord(baseVal)) {
        result[key] = applyMapMergeOperator(baseVal, projVal, `${path}.${key}`);
      } else {
        result[key] = applyArrayMergeOperator([], projVal, `${path}.${key}`);
      }
    } else if (
      isRecord(projVal) &&
      isRecord(baseVal) &&
      !Array.isArray(projVal) &&
      !Array.isArray(baseVal)
    ) {
      result[key] = deepMergeEntities(
        baseVal,
        projVal,
        `${path}.${key}`,
        hasExtends,
      );
    } else {
      result[key] = projVal;
    }
  }

  return result;
}

const OPERATOR_KEYS = new Set(["$append", "$prepend", "$insert_after", "$replace", "$remove"]);

export function mergeEntityMaps(
  baseMap: AnyRecord,
  projectMap: AnyRecord,
  path: string,
  hasExtends: boolean,
): AnyRecord {
  let result: AnyRecord;

  if (isRecord(projectMap) && !Array.isArray(projectMap)) {
    const op = hasOperator(projectMap);
    if (op) {
      if (!hasExtends) {
        throw new MergeError(
          `Merge operator used without extends at ${path}`,
        );
      }
      result = applyMapMergeOperator(baseMap, projectMap, path);
    } else {
      result = { ...baseMap };
    }
  } else {
    result = { ...baseMap };
  }

  for (const [key, projVal] of Object.entries(projectMap)) {
    if (OPERATOR_KEYS.has(key)) continue;
    const baseVal = result[key];
    if (baseVal !== undefined && isRecord(baseVal) && isRecord(projVal)) {
      result[key] = deepMergeEntities(
        baseVal,
        projVal as AnyRecord,
        `${path}.${key}`,
        hasExtends,
      );
    } else {
      result[key] = projVal;
    }
  }

  return result;
}

const MERGE_SECTIONS = [
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
];

export function mergeDsl(
  base: AnyRecord,
  project: AnyRecord,
): AnyRecord {
  const hasExtends = typeof project["extends"] === "string";
  const result: AnyRecord = { ...base, ...project };

  if (project["system"] && base["system"]) {
    result["system"] = deepMergeEntities(
      base["system"] as AnyRecord,
      project["system"] as AnyRecord,
      "system",
      hasExtends,
    );
  }

  for (const section of MERGE_SECTIONS) {
    const baseVal = base[section];
    const projVal = project[section];

    if (projVal === undefined) {
      continue;
    }

    const baseMap = isRecord(baseVal) ? baseVal : {};
    result[section] = mergeEntityMaps(
      baseMap,
      projVal as AnyRecord,
      section,
      hasExtends,
    );
  }

  delete result["extends"];
  return result;
}
