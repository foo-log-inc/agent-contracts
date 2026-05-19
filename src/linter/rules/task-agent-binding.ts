import type { Dsl } from "../../schema/index.js";
import type { LintRule, LintDiagnostic } from "../types.js";

export const taskAgentBindingRule: LintRule = {
  id: "task-agent-binding",
  description:
    "Bidirectional task-agent consistency: allowed_from_agents ↔ can_invoke_agents",

  run(dsl: Dsl): LintDiagnostic[] {
    const diagnostics: LintDiagnostic[] = [];

    const agentTaskTargets = new Map<string, string[]>();
    for (const [taskId, task] of Object.entries(dsl.tasks)) {
      if (!agentTaskTargets.has(task.target_agent)) {
        agentTaskTargets.set(task.target_agent, []);
      }
      agentTaskTargets.get(task.target_agent)!.push(taskId);
    }

    for (const [taskId, task] of Object.entries(dsl.tasks)) {
      for (const fromAgentId of task.allowed_from_agents) {
        if (fromAgentId === task.target_agent) continue;
        const fromAgent = dsl.agents[fromAgentId];
        if (fromAgent && !fromAgent.can_invoke_agents.includes(task.target_agent)) {
          diagnostics.push({
            ruleId: "task-agent-binding",
            severity: "error",
            path: `tasks.${taskId}.allowed_from_agents`,
            message: `Task "${taskId}" allows "${fromAgentId}" but agent's can_invoke_agents does not include target "${task.target_agent}"`,
          });
        }
      }
    }

    for (const [agentId, agent] of Object.entries(dsl.agents)) {
      if (agent.dispatch_only) continue;
      const tasks = agentTaskTargets.get(agentId) ?? [];
      if (tasks.length === 0) {
        diagnostics.push({
          ruleId: "task-agent-binding",
          severity: "warning",
          path: `agents.${agentId}`,
          message: `Agent "${agentId}" has no tasks assigned (target_agent). Consider adding dispatch_only if intentional.`,
        });
      }
    }

    for (const [taskId, task] of Object.entries(dsl.tasks)) {
      const targetAgent = dsl.agents[task.target_agent];
      if (!targetAgent) continue;

      for (const ref of task.input_artifacts) {
        if (!targetAgent.can_read_artifacts.includes(ref)) {
          diagnostics.push({
            ruleId: "task-agent-binding",
            severity: "error",
            path: `tasks.${taskId}.input_artifacts`,
            message: `Task "${taskId}" input_artifact "${ref}" not in target agent "${task.target_agent}" can_read_artifacts`,
          });
        }
      }

      if (!targetAgent.can_return_handoffs.includes(task.result_handoff)) {
        diagnostics.push({
          ruleId: "task-agent-binding",
          severity: "error",
          path: `tasks.${taskId}.result_handoff`,
          message: `Task "${taskId}" result_handoff "${task.result_handoff}" not in target agent "${task.target_agent}" can_return_handoffs`,
        });
      }
    }

    for (const [taskId, task] of Object.entries(dsl.tasks)) {
      if (!task.execution_steps) continue;
      const targetAgent = dsl.agents[task.target_agent];
      if (!targetAgent) continue;

      for (const step of task.execution_steps) {
        if (step.uses_tool) {
          if (!targetAgent.can_execute_tools.includes(step.uses_tool)) {
            diagnostics.push({
              ruleId: "task-agent-binding",
              severity: "error",
              path: `tasks.${taskId}.execution_steps`,
              message: `Task "${taskId}" step uses_tool "${step.uses_tool}" not in target agent "${task.target_agent}" can_execute_tools`,
            });
          }
          const tool = dsl.tools[step.uses_tool];
          if (tool && tool.invokable_by.length > 0 && !tool.invokable_by.includes(task.target_agent)) {
            diagnostics.push({
              ruleId: "task-agent-binding",
              severity: "warning",
              path: `tasks.${taskId}.execution_steps`,
              message: `Task "${taskId}" step uses_tool "${step.uses_tool}" but tool's invokable_by does not include "${task.target_agent}"`,
            });
          }
        }
        if (step.produces_artifact) {
          if (!targetAgent.can_write_artifacts.includes(step.produces_artifact)) {
            diagnostics.push({
              ruleId: "task-agent-binding",
              severity: "error",
              path: `tasks.${taskId}.execution_steps`,
              message: `Task "${taskId}" step produces_artifact "${step.produces_artifact}" not in target agent "${task.target_agent}" can_write_artifacts`,
            });
          }
        }
        if (step.reads_artifact) {
          if (!targetAgent.can_read_artifacts.includes(step.reads_artifact)) {
            diagnostics.push({
              ruleId: "task-agent-binding",
              severity: "error",
              path: `tasks.${taskId}.execution_steps`,
              message: `Task "${taskId}" step reads_artifact "${step.reads_artifact}" not in target agent "${task.target_agent}" can_read_artifacts`,
            });
          }
        }
      }
    }

    return diagnostics;
  },
};
