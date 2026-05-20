import { createRulesetFunction } from "@stoplight/spectral-core";

type AgentObj = {
  can_read_artifacts?: string[];
  prerequisites?: Array<{ action: string; target: string; required: boolean }>;
};

/**
 * Section 15.2.7: prerequisites[].target must be in the agent's can_read_artifacts.
 */
export default createRulesetFunction<AgentObj, null>(
  { input: { type: "object" }, options: null },
  (targetVal, _options, context) => {
    const readable = new Set(targetVal.can_read_artifacts ?? []);
    const prereqs = targetVal.prerequisites ?? [];
    if (readable.size === 0) return [];
    const results: { message: string; path: (string | number)[] }[] = [];

    for (let i = 0; i < prereqs.length; i++) {
      const p = prereqs[i];
      if (!readable.has(p.target)) {
        results.push({
          message: `prerequisite target "${p.target}" is not in can_read_artifacts`,
          path: [...context.path, "prerequisites", i, "target"],
        });
      }
    }
    return results;
  },
);
