import { readFile, readdir, stat as fsStat } from "node:fs/promises";
import { dirname, resolve, join, extname } from "node:path";
import { parse as parseYaml } from "yaml";

export interface LoadResult {
  data: Record<string, unknown>;
  filePath: string;
}

export class DslLoadError extends Error {
  constructor(
    message: string,
    public readonly filePath?: string,
  ) {
    super(message);
    this.name = "DslLoadError";
  }
}

type AnyRecord = Record<string, unknown>;

function isRecord(v: unknown): v is AnyRecord {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isRef(value: unknown): value is { $ref: string } {
  return (
    isRecord(value) &&
    "$ref" in value &&
    typeof value["$ref"] === "string"
  );
}

/** Deep-clone a value to prevent mutation when resolving in-document `$ref`. */
function deepClone(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  if (Array.isArray(value)) return value.map(deepClone);
  const result: AnyRecord = {};
  for (const [k, v] of Object.entries(value as AnyRecord)) {
    result[k] = deepClone(v);
  }
  return result;
}

/**
 * Resolve a JSON Pointer (RFC 6901) against the root document.
 *
 * Expects `pointer` to start with `#/`. Segment escapes (`~0` → `~`, `~1` → `/`)
 * are handled per the specification.
 *
 * @throws {DslLoadError} if a segment is not found or traverses a non-object.
 */
function resolveJsonPointer(root: AnyRecord, pointer: string): unknown {
  const path = pointer.slice(2);
  const segments = path.split("/").map((s) =>
    s.replace(/~1/g, "/").replace(/~0/g, "~"),
  );

  let current: unknown = root;
  for (const segment of segments) {
    if (!isRecord(current)) {
      throw new DslLoadError(
        `Cannot resolve JSON Pointer "${pointer}": path segment "${segment}" is not an object`,
      );
    }
    current = (current as AnyRecord)[segment];
    if (current === undefined) {
      throw new DslLoadError(
        `Cannot resolve JSON Pointer "${pointer}": path segment "${segment}" not found`,
      );
    }
  }
  return current;
}

function hasRefs(value: AnyRecord): value is AnyRecord & { $refs: string[] } {
  if (!("$refs" in value)) return false;
  const refs = value["$refs"];
  return Array.isArray(refs) && refs.every((r) => typeof r === "string");
}

async function readYaml(filePath: string): Promise<unknown> {
  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch {
    throw new DslLoadError(
      `File not found: ${filePath}`,
      filePath,
    );
  }

  try {
    return parseYaml(content);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new DslLoadError(
      `Invalid YAML syntax in ${filePath}: ${msg}`,
      filePath,
    );
  }
}

function deepMergeRefs(
  a: AnyRecord,
  b: AnyRecord,
  sourcePath: string,
): AnyRecord {
  const result: AnyRecord = { ...a };

  for (const [key, bVal] of Object.entries(b)) {
    const aVal = result[key];
    if (aVal === undefined) {
      result[key] = bVal;
    } else if (isRecord(aVal) && isRecord(bVal)) {
      result[key] = deepMergeRefs(aVal, bVal, sourcePath);
    } else {
      throw new DslLoadError(
        `Conflicting value for key "${key}" while merging $refs from ${sourcePath}`,
        sourcePath,
      );
    }
  }

  return result;
}

async function loadRefsSource(
  refPath: string,
  baseDir: string,
  resolving: Set<string>,
  rootDoc: AnyRecord,
): Promise<AnyRecord> {
  const target = resolve(baseDir, refPath);
  const s = await fsStat(target).catch(() => null);

  if (s?.isDirectory()) {
    if (resolving.has(target)) {
      throw new DslLoadError(`Circular $refs detected: ${target}`, target);
    }
    resolving.add(target);
    const result = await loadDirectoryAsMap(target, resolving, rootDoc);
    resolving.delete(target);
    return result;
  }

  if (!s?.isFile()) {
    throw new DslLoadError(`File not found: ${target}`, target);
  }

  if (resolving.has(target)) {
    throw new DslLoadError(`Circular $refs detected: ${target}`, target);
  }
  resolving.add(target);
  const content = await readYaml(target);

  if (!isRecord(content)) {
    throw new DslLoadError(
      `Expected YAML object in ${target}, got ${Array.isArray(content) ? "array" : typeof content}`,
      target,
    );
  }

  const resolved = (await resolveRefsDeep(
    content,
    dirname(target),
    resolving,
    rootDoc,
  )) as AnyRecord;
  resolving.delete(target);
  return resolved;
}

async function loadDirectoryAsMap(
  dirPath: string,
  resolving: Set<string>,
  rootDoc: AnyRecord,
): Promise<AnyRecord> {
  let entries: string[];
  try {
    entries = await readdir(dirPath);
  } catch {
    throw new DslLoadError(
      `Cannot read directory: ${dirPath}`,
      dirPath,
    );
  }

  const yamlFiles = entries
    .filter((f) => [".yaml", ".yml"].includes(extname(f)))
    .sort();

  if (yamlFiles.length === 0) {
    throw new DslLoadError(
      `No YAML files found in directory: ${dirPath}`,
      dirPath,
    );
  }

  let merged: AnyRecord = {};

  for (const file of yamlFiles) {
    const filePath = join(dirPath, file);
    const content = await readYaml(filePath);

    if (!isRecord(content)) {
      throw new DslLoadError(
        `Expected YAML object in ${filePath}, got ${Array.isArray(content) ? "array" : typeof content}`,
        filePath,
      );
    }

    const resolved = (await resolveRefsDeep(
      content,
      dirPath,
      resolving,
      rootDoc,
    )) as AnyRecord;

    merged = deepMergeRefs(merged, resolved, filePath);
  }

  return merged;
}

async function processRefs(
  obj: AnyRecord,
  baseDir: string,
  resolving: Set<string>,
  rootDoc: AnyRecord,
): Promise<AnyRecord> {
  const refPaths = obj["$refs"] as string[];
  const inline: AnyRecord = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key !== "$refs") {
      inline[key] = value;
    }
  }

  let merged: AnyRecord = {};

  for (const refPath of refPaths) {
    const loaded = await loadRefsSource(refPath, baseDir, resolving, rootDoc);
    merged = deepMergeRefs(merged, loaded, refPath);
  }

  merged = deepMergeRefs(merged, inline, "(inline)");

  return merged;
}

async function resolveRefsDeep(
  data: unknown,
  baseDir: string,
  resolving: Set<string>,
  rootDoc: AnyRecord,
): Promise<unknown> {
  if (typeof data !== "object" || data === null) return data;

  if (Array.isArray(data)) {
    return Promise.all(
      data.map((item) => resolveRefsDeep(item, baseDir, resolving, rootDoc)),
    );
  }

  // $ref: string — replace this object entirely
  if (isRef(data)) {
    const refValue = data.$ref;

    // JSON Pointer reference (#/...)
    if (refValue.startsWith("#/")) {
      if (resolving.has(refValue)) {
        throw new DslLoadError(`Circular $ref detected: ${refValue}`);
      }
      resolving.add(refValue);
      const target = resolveJsonPointer(rootDoc, refValue);
      const resolved = await resolveRefsDeep(
        deepClone(target),
        baseDir,
        resolving,
        rootDoc,
      );
      resolving.delete(refValue);
      return resolved;
    }

    // File reference with optional JSON Pointer fragment (file.yaml#/path)
    const hashIdx = refValue.indexOf("#");
    const filePart = hashIdx >= 0 ? refValue.slice(0, hashIdx) : refValue;
    const fragment = hashIdx >= 0 ? refValue.slice(hashIdx) : null;

    const refTarget = resolve(baseDir, filePart);
    const s = await fsStat(refTarget).catch(() => null);

    if (s?.isDirectory()) {
      if (fragment) {
        throw new DslLoadError(
          `Cannot use JSON Pointer fragment with directory $ref: ${refValue}`,
          refTarget,
        );
      }
      if (resolving.has(refTarget)) {
        throw new DslLoadError(
          `Circular $ref detected: ${refTarget}`,
          refTarget,
        );
      }
      resolving.add(refTarget);
      const result = await loadDirectoryAsMap(refTarget, resolving, rootDoc);
      resolving.delete(refTarget);
      return result;
    }

    if (!s?.isFile()) {
      throw new DslLoadError(`File not found: ${refTarget}`, refTarget);
    }

    if (resolving.has(refTarget)) {
      throw new DslLoadError(
        `Circular $ref detected: ${refTarget}`,
        refTarget,
      );
    }
    resolving.add(refTarget);
    const content = await readYaml(refTarget);
    const fileRoot = fragment ? content as AnyRecord : rootDoc;
    let fileData = await resolveRefsDeep(
      content,
      dirname(refTarget),
      resolving,
      fileRoot,
    );
    resolving.delete(refTarget);

    if (fragment && fragment.startsWith("#/")) {
      if (!isRecord(fileData)) {
        throw new DslLoadError(
          `Cannot resolve fragment "${fragment}" in ${refTarget}: file content is not an object`,
          refTarget,
        );
      }
      fileData = resolveJsonPointer(fileData as AnyRecord, fragment);
    }

    return fileData;
  }

  let obj = data as AnyRecord;

  // $refs: string[] — import files and deep-merge into this map
  if (hasRefs(obj)) {
    obj = await processRefs(obj, baseDir, resolving, rootDoc);
  }

  // Recurse into values
  const result: AnyRecord = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key] = await resolveRefsDeep(value, baseDir, resolving, rootDoc);
  }
  return result;
}

function checkVersion(data: Record<string, unknown>, filePath: string): void {
  const version = data["version"];
  if (version === undefined) {
    throw new DslLoadError(
      `Missing DSL version in ${filePath}: expected version: 1`,
      filePath,
    );
  }
  if (version !== 1) {
    throw new DslLoadError(
      `Unsupported DSL version in ${filePath}: expected 1, got ${JSON.stringify(version)}`,
      filePath,
    );
  }
}

export async function loadDsl(entryPath: string): Promise<LoadResult> {
  const absPath = resolve(entryPath);
  const raw = await readYaml(absPath);

  if (typeof raw !== "object" || raw === null) {
    throw new DslLoadError(
      `Expected YAML object in ${absPath}, got ${typeof raw}`,
      absPath,
    );
  }

  const data = raw as Record<string, unknown>;
  checkVersion(data, absPath);

  const baseDir = dirname(absPath);
  const resolving = new Set<string>([absPath]);
  const resolved = (await resolveRefsDeep(
    data,
    baseDir,
    resolving,
    data,
  )) as Record<string, unknown>;

  return { data: resolved, filePath: absPath };
}
