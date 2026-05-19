import type { Dsl } from "../../schema/index.js";
import type { LintRule, LintDiagnostic } from "../types.js";

export const toolExecutionRule: LintRule = {
  id: "tool-execution",
  description:
    "Bidirectional consistency: agent.can_execute_tools ↔ tool.invokable_by",

  run(dsl: Dsl): LintDiagnostic[] {
    const diagnostics: LintDiagnostic[] = [];

    const toolInvokableBy = new Map<string, Set<string>>();
    for (const [toolId, tool] of Object.entries(dsl.tools)) {
      toolInvokableBy.set(toolId, new Set(tool.invokable_by));
    }

    for (const [agentId, agent] of Object.entries(dsl.agents)) {
      for (const toolId of agent.can_execute_tools) {
        const invokableBy = toolInvokableBy.get(toolId);
        if (invokableBy && invokableBy.size > 0 && !invokableBy.has(agentId)) {
          diagnostics.push({
            ruleId: "tool-execution",
            severity: "warning",
            path: `agents.${agentId}.can_execute_tools`,
            message: `Agent "${agentId}" has can_execute_tools "${toolId}" but tool's invokable_by does not include "${agentId}"`,
          });
        }
      }
    }

    for (const [toolId, tool] of Object.entries(dsl.tools)) {
      if (tool.invokable_by.length === 0) continue;
      for (const agentId of tool.invokable_by) {
        const agent = dsl.agents[agentId];
        if (agent && !agent.can_execute_tools.includes(toolId)) {
          diagnostics.push({
            ruleId: "tool-execution",
            severity: "warning",
            path: `tools.${toolId}.invokable_by`,
            message: `Tool "${toolId}" has invokable_by "${agentId}" but agent's can_execute_tools does not include "${toolId}"`,
          });
        }
      }
    }

    for (const [taskId, task] of Object.entries(dsl.tasks)) {
      if (!task.execution_steps) continue;
      for (const step of task.execution_steps) {
        if (!step.uses_tool) continue;
        const targetAgent = dsl.agents[task.target_agent];
        if (targetAgent && !targetAgent.can_execute_tools.includes(step.uses_tool)) {
          diagnostics.push({
            ruleId: "tool-execution",
            severity: "error",
            path: `tasks.${taskId}.execution_steps`,
            message: `Task "${taskId}" step uses_tool "${step.uses_tool}" but target agent "${task.target_agent}" cannot execute it`,
          });
        }
      }
    }

    for (const [valId, val] of Object.entries(dsl.validations)) {
      if (val.executor_type !== "tool" || !val.executor) continue;
      const hasExecutor = Object.values(dsl.agents).some((a) =>
        a.can_execute_tools.includes(val.executor!),
      );
      if (!hasExecutor) {
        diagnostics.push({
          ruleId: "tool-execution",
          severity: "error",
          path: `validations.${valId}`,
          message: `Validation "${valId}" has executor_type=tool (executor: "${val.executor}") but no agent can execute this tool`,
        });
      }
    }

    return diagnostics;
  },
};
