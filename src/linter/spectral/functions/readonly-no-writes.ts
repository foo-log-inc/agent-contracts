import { isRecord, type RuleFunction } from "../types.js";

/**
 * Section 15.2.7: read-only agent must have empty can_write_artifacts.
 */
const readonlyNoWrites: RuleFunction = (value, context) => {
  if (!isRecord(value)) return [];
  if (
    value.mode === "read-only" &&
    Array.isArray(value.can_write_artifacts) &&
    value.can_write_artifacts.length > 0
  ) {
    return [
      {
        message:
          'Agent with mode "read-only" must have empty can_write_artifacts',
        path: [...context.path, "can_write_artifacts"],
      },
    ];
  }
  return [];
};

export default readonlyNoWrites;
