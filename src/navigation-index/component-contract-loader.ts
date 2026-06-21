import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

export interface ComponentContractSlotInfo {
  artifactSlots: Record<string, { direction: "read" | "write" | "readwrite" }>;
}

function parseSlotDirection(
  slotDef: unknown,
): "read" | "write" | "readwrite" | null {
  if (!slotDef || typeof slotDef !== "object") return null;
  const direction = (slotDef as Record<string, unknown>).direction;
  if (direction === "read" || direction === "write" || direction === "readwrite") {
    return direction;
  }
  return null;
}

function extractArtifactSlots(
  slots: unknown,
): Record<string, { direction: "read" | "write" | "readwrite" }> | null {
  if (!slots || typeof slots !== "object") return null;

  const result: Record<string, { direction: "read" | "write" | "readwrite" }> = {};
  for (const [name, slotDef] of Object.entries(slots)) {
    if (typeof slotDef === "string") {
      result[name] = { direction: "readwrite" };
      continue;
    }
    const direction = parseSlotDirection(slotDef);
    if (direction) {
      result[name] = { direction };
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

function extractOperationSlots(
  doc: Record<string, unknown>,
  command: string,
): Record<string, { direction: "read" | "write" | "readwrite" }> | null {
  const operations = doc.operations;
  if (!operations || typeof operations !== "object") return null;

  const operation = (operations as Record<string, unknown>)[command];
  if (!operation || typeof operation !== "object") return null;

  const slots = (operation as Record<string, unknown>).artifact_slots;
  return extractArtifactSlots(slots);
}

function resolveComponentContractPath(componentContractPath: string): string {
  return isAbsolute(componentContractPath)
    ? componentContractPath
    : resolve(process.cwd(), componentContractPath);
}

export function loadComponentContractSlots(
  componentContractPath: string,
  command?: string,
): ComponentContractSlotInfo | null {
  const filePath = resolveComponentContractPath(componentContractPath);
  if (!existsSync(filePath)) return null;

  let doc: unknown;
  try {
    doc = parseYaml(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }

  if (!doc || typeof doc !== "object") return null;
  const record = doc as Record<string, unknown>;

  let artifactSlots: Record<string, { direction: "read" | "write" | "readwrite" }> | null =
    null;

  if (command) {
    artifactSlots = extractOperationSlots(record, command);
  }

  if (!artifactSlots) {
    artifactSlots = extractArtifactSlots(record.artifact_slots);
  }

  if (!artifactSlots) return null;

  return { artifactSlots };
}

export function resolveComponentSlotDirection(
  slot: string,
  slotInfo: ComponentContractSlotInfo,
): "read" | "write" {
  const slotDecl = slotInfo.artifactSlots[slot];
  if (!slotDecl) return "read";
  if (slotDecl.direction === "write" || slotDecl.direction === "readwrite") {
    return "write";
  }
  return "read";
}
