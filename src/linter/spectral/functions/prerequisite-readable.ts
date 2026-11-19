import { isRecord, type RuleFunction, type RuleResult } from "../types.js";

type AgentObj = {
  can_read_artifacts?: string[];
  prerequisites?: Array<{ action: string; target: string; required: boolean }>;
};

/**
 * Section 15.2.7: prerequisites[].target must be in the agent's can_read_artifacts.
 */
const prerequisiteReadable: RuleFunction = (value, context) => {
  if (!isRecord(value)) return [];
  const agent = value as AgentObj;
  const readable = new Set(agent.can_read_artifacts ?? []);
  const prereqs = agent.prerequisites ?? [];
  if (readable.size === 0) return [];
  const results: RuleResult[] = [];

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
};

export default prerequisiteReadable;
