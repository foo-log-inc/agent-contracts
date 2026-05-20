import { createRulesetFunction } from "@stoplight/spectral-core";

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
export default createRulesetFunction<string[], null>(
  { input: { type: "array" }, options: null },
  (targetVal, _options, context) => {
    const root = context.document.data as {
      artifacts?: Record<string, ArtifactObj>;
    };
    const artId =
      context.path.length >= 2 ? String(context.path[1]) : undefined;
    const artifact =
      artId && root.artifacts ? root.artifacts[artId] : undefined;

    if (artifact && allDeprecatedOwnershipFieldsEmpty(artifact)) {
      return [];
    }

    if (targetVal.length === 0) {
      return [{ message: "editors must not be empty" }];
    }
    return [];
  },
);
