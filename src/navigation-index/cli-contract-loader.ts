import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

export interface CliContractSlotInfo {
  artifactSlots: Record<string, { direction: "read" | "write" | "readwrite" }>;
  commandEffects: Record<string, { reads: string[]; writes: string[] }>;
}

function extractStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function extractArtifactSlots(
  doc: Record<string, unknown>,
): Record<string, { direction: "read" | "write" | "readwrite" }> | null {
  const slots = doc.artifact_slots;
  if (!slots || typeof slots !== "object") return null;

  const result: Record<string, { direction: "read" | "write" | "readwrite" }> = {};
  for (const [name, slotDef] of Object.entries(slots)) {
    if (!slotDef || typeof slotDef !== "object") continue;
    const direction = (slotDef as Record<string, unknown>).direction;
    if (direction === "read" || direction === "write" || direction === "readwrite") {
      result[name] = { direction };
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

function extractCommandEffects(
  doc: Record<string, unknown>,
): Record<string, { reads: string[]; writes: string[] }> {
  const result: Record<string, { reads: string[]; writes: string[] }> = {};
  const commandSets = doc.command_sets;
  if (!commandSets || typeof commandSets !== "object") return result;

  for (const setDef of Object.values(commandSets)) {
    if (!setDef || typeof setDef !== "object") continue;
    const commands = (setDef as Record<string, unknown>).commands;
    if (!commands || typeof commands !== "object") continue;

    for (const [cmdName, cmdDef] of Object.entries(commands)) {
      if (!cmdDef || typeof cmdDef !== "object") continue;
      const effects = (cmdDef as Record<string, unknown>).effects;
      if (!effects || typeof effects !== "object") continue;

      result[cmdName] = {
        reads: extractStringArray((effects as Record<string, unknown>).reads),
        writes: extractStringArray((effects as Record<string, unknown>).writes),
      };
    }
  }

  return result;
}

function resolveCliContractPath(cliContractPath: string): string {
  return isAbsolute(cliContractPath) ? cliContractPath : resolve(process.cwd(), cliContractPath);
}

export function loadCliContractSlots(cliContractPath: string): CliContractSlotInfo | null {
  const filePath = resolveCliContractPath(cliContractPath);
  if (!existsSync(filePath)) return null;

  let doc: unknown;
  try {
    doc = parseYaml(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }

  if (!doc || typeof doc !== "object") return null;

  const artifactSlots = extractArtifactSlots(doc as Record<string, unknown>);
  if (!artifactSlots) return null;

  return {
    artifactSlots,
    commandEffects: extractCommandEffects(doc as Record<string, unknown>),
  };
}

export function resolveSlotDirection(
  slot: string,
  command: string,
  slotInfo: CliContractSlotInfo,
): "read" | "write" {
  const cmdEffects = slotInfo.commandEffects[command];
  if (cmdEffects) {
    if (cmdEffects.writes.includes(slot)) return "write";
    if (cmdEffects.reads.includes(slot)) return "read";
  }

  const slotDecl = slotInfo.artifactSlots[slot];
  if (slotDecl) {
    if (slotDecl.direction === "write" || slotDecl.direction === "readwrite") {
      return "write";
    }
    return "read";
  }

  return "read";
}
