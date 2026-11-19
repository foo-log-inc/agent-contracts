import type { RuleFunction } from "../types.js";

type ArtifactObj = {
  owner?: string;
  producers?: string[];
  editors?: string[];
  consumers?: string[];
};

function allDeprecatedOwnershipFieldsEmpty(art: ArtifactObj): boolean {
  return (
    !art.owner &&
    (art.producers?.length ?? 0) === 0 &&
    (art.editors?.length ?? 0) === 0 &&
    (art.consumers?.length ?? 0) === 0
  );
}

/**
 * Validates that the editors array is not empty when other deprecated
 * ownership fields are set. Skips when all deprecated ownership fields
 * are empty (binding-model state).
 */
const editorsNotEmpty: RuleFunction = (value, context) => {
  if (!Array.isArray(value)) return [];
  const artifacts = context.document.artifacts as Record<string, ArtifactObj> | undefined;
  const artId = context.path.length >= 2 ? String(context.path[1]) : undefined;
  const artifact = artId && artifacts ? artifacts[artId] : undefined;

  if (artifact && allDeprecatedOwnershipFieldsEmpty(artifact)) {
    return [];
  }

  if (value.length === 0) {
    return [{ message: "editors must not be empty" }];
  }
  return [];
};

export default editorsNotEmpty;
