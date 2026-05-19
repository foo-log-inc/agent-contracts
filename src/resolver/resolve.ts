import { dirname, resolve as resolvePath } from "node:path";
import { loadDsl } from "../loader/index.js";
import { resolveBase, BaseResolveError } from "./base-resolver.js";
import { mergeDsl } from "./merger.js";

export interface ResolveResult {
  data: Record<string, unknown>;
  projectPath: string;
  basePaths: string[];
}

interface ResolvedChain {
  data: Record<string, unknown>;
  basePaths: string[];
}

async function resolveExtendsChain(
  data: Record<string, unknown>,
  filePath: string,
  seen: Set<string>,
): Promise<ResolvedChain> {
  const extendsValue = data["extends"];
  if (typeof extendsValue !== "string") {
    return { data, basePaths: [] };
  }

  const projectDir = dirname(filePath);
  const baseResult = await resolveBase(extendsValue, projectDir);
  const basePath = baseResult.filePath;

  if (seen.has(basePath)) {
    throw new BaseResolveError(
      `Circular extends detected: ${basePath}`,
    );
  }
  seen.add(basePath);

  const { data: resolvedBase, basePaths: ancestorPaths } =
    await resolveExtendsChain(baseResult.data, basePath, seen);

  const merged = mergeDsl(resolvedBase, data);

  return {
    data: merged,
    basePaths: [...ancestorPaths, basePath],
  };
}

export async function resolve(
  projectDirOrFile: string,
): Promise<ResolveResult> {
  const absPath = resolvePath(projectDirOrFile);
  const projectResult = await loadDsl(absPath);
  const { data, basePaths } = await resolveExtendsChain(
    projectResult.data,
    projectResult.filePath,
    new Set(),
  );

  return {
    data,
    projectPath: projectResult.filePath,
    basePaths,
  };
}
