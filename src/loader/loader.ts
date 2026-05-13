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
 * Resolve a JSON Pointer (RFC 6901) against a root object.
 *
 * Expects `pointer` to start with `#/`. Segment escapes (`~0` → `~`,
 * `~1` → `/`) are handled per the specification.
 *
 * @returns `{ found: true, value }` if the pointer resolves, or
 *          `{ found: false }` if any segment is missing.
 * @throws {DslLoadError} if traversal hits a non-object.
 */
function tryResolveJsonPointer(
  root: AnyRecord,
  pointer: string,
): { found: true; value: unknown } | { found: false } {
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
      return { found: false };
    }
  }
  return { found: true, value: current };
}

/**
 * Strict variant — throws when the pointer target is missing.
 * Used in Phase 2 (linking) where all sections are available.
 */
function resolveJsonPointer(root: AnyRecord, pointer: string): unknown {
  const result = tryResolveJsonPointer(root, pointer);
  if (!result.found) {
    throw new DslLoadError(
      `Cannot resolve JSON Pointer "${pointer}": target not found`,
    );
  }
  return result.value;
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

// ===================================================================
// Phase 1 — Assembly
//
// Loads external file $ref/$refs and resolves file-internal #/ pointers
// against each file's own root.  Cross-section #/ pointers that can't
// resolve within the file are preserved for Phase 2.
// ===================================================================

async function loadRefsSource(
  refPath: string,
  baseDir: string,
  resolving: Set<string>,
): Promise<AnyRecord> {
  const target = resolve(baseDir, refPath);
  const s = await fsStat(target).catch(() => null);

  if (s?.isDirectory()) {
    if (resolving.has(target)) {
      throw new DslLoadError(`Circular $refs detected: ${target}`, target);
    }
    resolving.add(target);
    const result = await loadDirectoryAsMap(target, resolving);
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

  const resolved = (await assembleRefs(
    content,
    dirname(target),
    resolving,
    content as AnyRecord,
  )) as AnyRecord;
  resolving.delete(target);
  return resolved;
}

async function loadDirectoryAsMap(
  dirPath: string,
  resolving: Set<string>,
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

    const resolved = (await assembleRefs(
      content,
      dirPath,
      resolving,
      content as AnyRecord,
    )) as AnyRecord;

    merged = deepMergeRefs(merged, resolved, filePath);
  }

  return merged;
}

async function processRefs(
  obj: AnyRecord,
  baseDir: string,
  resolving: Set<string>,
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
    const loaded = await loadRefsSource(refPath, baseDir, resolving);
    merged = deepMergeRefs(merged, loaded, refPath);
  }

  merged = deepMergeRefs(merged, inline, "(inline)");

  return merged;
}

/**
 * Phase 1 — Assembly.
 *
 * Recursively resolves external file `$ref` / `$refs` and builds the
 * assembled document tree.
 *
 * `#/` pointers are resolved against `fileRoot` (the current file's
 * own root).  If the target doesn't exist within the file, the `$ref`
 * is preserved as-is — it likely references another section of the DSL
 * and will be resolved in Phase 2 (linking).
 */
async function assembleRefs(
  data: unknown,
  baseDir: string,
  resolving: Set<string>,
  fileRoot: AnyRecord,
): Promise<unknown> {
  if (typeof data !== "object" || data === null) return data;

  if (Array.isArray(data)) {
    return Promise.all(
      data.map((item) => assembleRefs(item, baseDir, resolving, fileRoot)),
    );
  }

  if (isRef(data)) {
    const refValue = data.$ref;

    // In-document pointer — resolve against current file root.
    // Preserve if not found (cross-section ref for Phase 2).
    if (refValue.startsWith("#/")) {
      if (resolving.has(refValue)) {
        throw new DslLoadError(`Circular $ref detected: ${refValue}`);
      }
      const result = tryResolveJsonPointer(fileRoot, refValue);
      if (!result.found) {
        return data;
      }
      resolving.add(refValue);
      const resolved = await assembleRefs(
        deepClone(result.value),
        baseDir,
        resolving,
        fileRoot,
      );
      resolving.delete(refValue);
      return resolved;
    }

    // External file reference (with optional #/fragment)
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
      const result = await loadDirectoryAsMap(refTarget, resolving);
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
    // Each file gets its own root scope for #/ pointer resolution.
    const newFileRoot = isRecord(content) ? (content as AnyRecord) : fileRoot;
    let fileData = await assembleRefs(
      content,
      dirname(refTarget),
      resolving,
      newFileRoot,
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

  if (hasRefs(obj)) {
    obj = await processRefs(obj, baseDir, resolving);
  }

  const result: AnyRecord = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key] = await assembleRefs(value, baseDir, resolving, fileRoot);
  }
  return result;
}

// ===================================================================
// Phase 2 — Linking
//
// Walks the assembled document and resolves all remaining #/ pointers
// against the fully-expanded root.  No file I/O; pure pointer resolution.
// Unresolvable pointers are errors — the document is fully assembled.
// ===================================================================

/**
 * Phase 2 — Linking.
 *
 * Resolves every remaining `#/` pointer against the assembled document
 * root.  Any pointer that can't be resolved is a genuine error — by
 * this point the entire document has been assembled from all files.
 */
function linkDocPointers(data: unknown, rootDoc: AnyRecord): unknown {
  if (typeof data !== "object" || data === null) return data;

  if (Array.isArray(data)) {
    return data.map((item) => linkDocPointers(item, rootDoc));
  }

  if (isRef(data)) {
    const refValue = data.$ref;
    if (refValue.startsWith("#/")) {
      const target = resolveJsonPointer(rootDoc, refValue);
      return linkDocPointers(deepClone(target), rootDoc);
    }
    // Non-#/ $ref should not remain after Phase 1 — preserve as-is
    // (defensive; assembleRefs should have resolved all file refs).
    return data;
  }

  const obj = data as AnyRecord;
  const result: AnyRecord = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key] = linkDocPointers(value, rootDoc);
  }
  return result;
}

// ===================================================================
// Public API
// ===================================================================

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

  // Phase 1 — Assembly: load all external files and resolve
  // file-internal #/ pointers.  Cross-section #/ pointers are preserved.
  const assembled = (await assembleRefs(
    data,
    baseDir,
    new Set<string>([absPath]),
    data,
  )) as Record<string, unknown>;

  // Phase 2 — Linking: resolve remaining #/ pointers against the
  // fully-assembled root.  Failure here is a genuine broken reference.
  const resolved = linkDocPointers(
    assembled,
    assembled,
  ) as Record<string, unknown>;

  return { data: resolved, filePath: absPath };
}
