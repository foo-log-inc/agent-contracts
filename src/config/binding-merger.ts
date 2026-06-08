import { mergeSection, type SectionMode } from "../resolver/index.js";

type AnyRecord = Record<string, unknown>;

const BINDING_SECTIONS: Record<string, SectionMode> = {
  guardrail_impl: "map",
  outputs: "map",
  renders: "array",
  reporting: "object",
  event_mapping: "map",
};

export function mergeBinding(
  base: AnyRecord,
  project: AnyRecord,
): AnyRecord {
  const hasExtends = typeof project["extends"] === "string";
  const result: AnyRecord = { ...base, ...project };

  for (const [section, mode] of Object.entries(BINDING_SECTIONS)) {
    if (project[section] === undefined) continue;
    result[section] = mergeSection(
      base[section],
      project[section],
      section,
      hasExtends,
      mode,
    );
  }

  delete result["extends"];
  return result;
}
