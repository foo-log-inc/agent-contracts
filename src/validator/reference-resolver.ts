import type { Dsl } from "../schema/index.js";
import { resolveAllOf } from "../schema/index.js";

export interface ReferenceDiagnostic {
  path: string;
  message: string;
  code: string;
  severity: "error";
}

/**
 * Reference and handoff-schema integrity of a parsed DSL. `validate`, `lint`
 * and `check` report these diagnostics; every one is an error.
 */
export function checkReferences(dsl: Dsl): ReferenceDiagnostic[] {
  const diagnostics: ReferenceDiagnostic[] = [];

  function report(path: string, message: string, code: string) {
    diagnostics.push({ path, message, code, severity: "error" });
  }

  const agentIds = new Set(Object.keys(dsl.agents));
  const artifactIds = new Set(Object.keys(dsl.artifacts));
  const toolIds = new Set(Object.keys(dsl.tools));
  const validationIds = new Set(Object.keys(dsl.validations));
  const handoffKinds = new Set(Object.keys(dsl.handoff_types));
  const taskIds = new Set(Object.keys(dsl.tasks));
  const workflowIds = new Set(dsl.system.default_workflow_order);
  const guardrailIds = new Set(Object.keys(dsl.guardrails));

  function checkExists(
    value: string,
    validSet: Set<string>,
    entityType: string,
    path: string,
    code: string = "reference-not-found",
  ) {
    if (!validSet.has(value)) {
      report(path, `Reference "${value}" not found in ${entityType}`, code);
    }
  }

  for (const [id, agent] of Object.entries(dsl.agents)) {
    for (const ref of agent.own_artifacts) {
      checkExists(ref, artifactIds, "artifacts", `agents.${id}.own_artifacts`);
    }
    for (const ref of agent.can_read_artifacts) {
      checkExists(ref, artifactIds, "artifacts", `agents.${id}.can_read_artifacts`);
    }
    for (const ref of agent.can_write_artifacts) {
      checkExists(ref, artifactIds, "artifacts", `agents.${id}.can_write_artifacts`);
    }
    for (const ref of agent.can_execute_tools) {
      checkExists(ref, toolIds, "tools", `agents.${id}.can_execute_tools`);
    }
    for (const ref of agent.can_perform_validations) {
      checkExists(ref, validationIds, "validations", `agents.${id}.can_perform_validations`);
    }
    for (const ref of agent.can_invoke_agents) {
      checkExists(ref, agentIds, "agents", `agents.${id}.can_invoke_agents`);
    }
    for (const ref of agent.can_return_handoffs) {
      checkExists(ref, handoffKinds, "handoff_types", `agents.${id}.can_return_handoffs`);
    }
  }

  for (const [id, art] of Object.entries(dsl.artifacts)) {
    if (art.owner) {
      checkExists(art.owner, agentIds, "agents", `artifacts.${id}.owner`);
    }
    if (art.producers.length > 0) {
      for (const ref of art.producers) {
        checkExists(ref, agentIds, "agents", `artifacts.${id}.producers`);
      }
    }
    if (art.editors.length > 0) {
      for (const ref of art.editors) {
        checkExists(ref, agentIds, "agents", `artifacts.${id}.editors`);
      }
    }
    if (art.consumers.length > 0) {
      for (const ref of art.consumers) {
        checkExists(ref, agentIds, "agents", `artifacts.${id}.consumers`);
      }
    }
    for (const ref of art.required_validations) {
      checkExists(ref, validationIds, "validations", `artifacts.${id}.required_validations`);
    }
  }

  for (const [id, art] of Object.entries(dsl.artifacts)) {
    if (art.owner) {
      const ownerAgent = dsl.agents[art.owner];
      if (ownerAgent && ownerAgent.can_read_artifacts.length > 0 && !ownerAgent.can_read_artifacts.includes(id)) {
        report(
          `artifacts.${id}.owner`,
          `Agent "${art.owner}" owns artifact "${id}" but cannot read it (missing from can_read_artifacts)`,
          "artifact-owner-no-read",
        );
      }
    }
    for (const valId of art.required_validations) {
      const validation = dsl.validations[valId];
      if (validation?.executor_type === "tool" && validation.executor) {
        const tool = dsl.tools[validation.executor];
        if (tool && tool.invokable_by.length === 0) {
          report(
            `artifacts.${id}.required_validations`,
            `Validation "${valId}" uses tool "${validation.executor}" which has no agents in invokable_by`,
            "validation-executor-unreachable",
          );
        }
      }
    }
  }

  for (const [id, tool] of Object.entries(dsl.tools)) {
    if (tool.extends) {
      checkExists(
        tool.extends,
        toolIds,
        "tools",
        `tools.${id}.extends`,
        "tool-extends-not-found",
      );
    }
    if (tool.invokable_by.length > 0) {
      for (const ref of tool.invokable_by) {
        checkExists(ref, agentIds, "agents", `tools.${id}.invokable_by`);
      }
    }
    for (const ref of Object.values(tool.artifact_bindings)) {
      checkExists(ref, artifactIds, "artifacts", `tools.${id}.artifact_bindings`);
    }
  }

  for (const [id, val] of Object.entries(dsl.validations)) {
    checkExists(val.target_artifact, artifactIds, "artifacts", `validations.${id}.target_artifact`);
    if (val.executor_type === "tool" && val.executor) {
      checkExists(val.executor, toolIds, "tools", `validations.${id}.executor`);
    } else if (val.executor_type === "agent" && val.executor) {
      checkExists(val.executor, agentIds, "agents", `validations.${id}.executor`);
    }
  }

  for (const [id, task] of Object.entries(dsl.tasks)) {
    checkExists(task.target_agent, agentIds, "agents", `tasks.${id}.target_agent`);
    for (const ref of task.allowed_from_agents) {
      checkExists(ref, agentIds, "agents", `tasks.${id}.allowed_from_agents`);
    }
    checkExists(task.workflow, workflowIds, "system.default_workflow_order", `tasks.${id}.workflow`);
    checkExists(task.invocation_handoff, handoffKinds, "handoff_types", `tasks.${id}.invocation_handoff`);
    checkExists(task.result_handoff, handoffKinds, "handoff_types", `tasks.${id}.result_handoff`);
    for (const ref of task.input_artifacts) {
      checkExists(ref, artifactIds, "artifacts", `tasks.${id}.input_artifacts`);
    }
    for (const ref of task.validations) {
      checkExists(ref, validationIds, "validations", `tasks.${id}.validations`);
    }
  }

  for (const [wfId, wf] of Object.entries(dsl.workflow)) {
    checkExists(wfId, workflowIds, "system.default_workflow_order", `workflow.${wfId}`);
    for (let j = 0; j < wf.steps.length; j++) {
      const step = wf.steps[j];
      if (step.type === "delegate") {
        checkExists(step.task, taskIds, "tasks", `workflow.${wfId}.steps[${j}].task`);
        checkExists(step.from_agent, agentIds, "agents", `workflow.${wfId}.steps[${j}].from_agent`);
      } else if (step.type === "gate") {
        checkExists(step.gate_kind, handoffKinds, "handoff_types", `workflow.${wfId}.steps[${j}].gate_kind`);
      } else if (step.type === "handoff") {
        checkExists(step.handoff_kind, handoffKinds, "handoff_types", `workflow.${wfId}.steps[${j}].handoff_kind`);
        if (step.task) {
          checkExists(step.task, taskIds, "tasks", `workflow.${wfId}.steps[${j}].task`);
        }
        if (step.from_agent) {
          checkExists(step.from_agent, agentIds, "agents", `workflow.${wfId}.steps[${j}].from_agent`);
        }
      } else if (step.type === "validation") {
        checkExists(step.validation, validationIds, "validations", `workflow.${wfId}.steps[${j}].validation`);
      } else if (step.type === "team_task") {
        const importKeys =
          dsl.imports !== undefined ? new Set(Object.keys(dsl.imports)) : null;
        if (importKeys) {
          checkExists(
            step.to_team,
            importKeys,
            "imports",
            `workflow.${wfId}.steps[${j}].to_team`,
            "team-import-not-found",
          );
        } else {
          report(
            `workflow.${wfId}.steps[${j}].to_team`,
            `team_task step references team "${step.to_team}" but dsl.imports is not defined`,
            "team-task-missing-imports",
          );
        }
        checkExists(step.handoff, handoffKinds, "handoff_types", `workflow.${wfId}.steps[${j}].handoff`);
        checkExists(step.expects, handoffKinds, "handoff_types", `workflow.${wfId}.steps[${j}].expects`);
      }
    }
  }

  for (const [id, task] of Object.entries(dsl.tasks)) {
    const targetAgent = dsl.agents[task.target_agent];
    if (targetAgent) {
      if (!targetAgent.can_return_handoffs.includes(task.result_handoff)) {
        report(
          `tasks.${id}.result_handoff`,
          `Task result_handoff "${task.result_handoff}" is not in target agent "${task.target_agent}" can_return_handoffs`,
          "result-handoff-not-returnable",
        );
      }
      if (targetAgent.can_read_artifacts.length > 0) {
        for (let j = 0; j < task.input_artifacts.length; j++) {
          const inputId = task.input_artifacts[j];
          if (!targetAgent.can_read_artifacts.includes(inputId)) {
            report(
              `tasks.${id}.input_artifacts[${j}]`,
              `Input artifact "${inputId}" is not in target agent "${task.target_agent}" can_read_artifacts`,
              "input-artifact-not-readable",
            );
          }
        }
      }
    }
  }

  for (const [id, agent] of Object.entries(dsl.agents)) {
    if (agent.mode === "read-only" && agent.can_write_artifacts.length > 0) {
      report(
        `agents.${id}.can_write_artifacts`,
        `Agent "${id}" has mode "read-only" but can_write_artifacts is not empty`,
        "readonly-agent-has-writes",
      );
    }
    if (agent.prerequisites) {
      for (let j = 0; j < agent.prerequisites.length; j++) {
        const pre = agent.prerequisites[j];
        if (agent.can_read_artifacts.length > 0 && !agent.can_read_artifacts.includes(pre.target)) {
          report(
            `agents.${id}.prerequisites[${j}].target`,
            `Prerequisite target "${pre.target}" is not in agent "${id}" can_read_artifacts`,
            "prerequisite-not-readable",
          );
        }
      }
    }
  }

  function isSchemaObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  /** `required` vs. `properties` and empty `enum`s of one object schema, then of its nested objects and object `items`. */
  function checkHandoffSchema(schema: Record<string, unknown>, path: string) {
    const effectiveSchema = resolveAllOf(schema);
    const required = effectiveSchema.required;
    const properties = effectiveSchema.properties;
    if (!isSchemaObject(properties)) return;
    if (Array.isArray(required)) {
      for (let j = 0; j < required.length; j++) {
        const key = required[j];
        if (typeof key === "string" && !(key in properties)) {
          report(
            `${path}.required[${j}]`,
            `Handoff schema required field "${key}" is not a key in schema.properties`,
            "schema-required-not-in-properties",
          );
        }
      }
    }
    for (const [propKey, propSchema] of Object.entries(properties)) {
      if (!isSchemaObject(propSchema)) continue;
      const propPath = `${path}.properties.${propKey}`;
      const enumVal = propSchema.enum;
      if (Array.isArray(enumVal) && enumVal.length === 0) {
        report(propPath, `Handoff schema property "${propKey}" has an empty enum`, "schema-empty-enum");
      }
      if (propSchema.type === "object") checkHandoffSchema(propSchema, propPath);
      if (isSchemaObject(propSchema.items) && propSchema.items.type === "object") {
        checkHandoffSchema(propSchema.items, `${propPath}.items`);
      }
    }
  }

  for (const [kind, ht] of Object.entries(dsl.handoff_types)) {
    checkHandoffSchema(ht.schema as Record<string, unknown>, `handoff_types.${kind}.schema`);
  }

  for (const [id, agent] of Object.entries(dsl.agents)) {
    if (agent.guardrails) {
      for (const ref of agent.guardrails) {
        checkExists(ref, guardrailIds, "guardrails", `agents.${id}.guardrails`, "entity-guardrail-ref-not-found");
      }
    }
  }

  for (const [id, task] of Object.entries(dsl.tasks)) {
    if (task.guardrails) {
      for (const ref of task.guardrails) {
        checkExists(ref, guardrailIds, "guardrails", `tasks.${id}.guardrails`, "entity-guardrail-ref-not-found");
      }
    }
  }

  for (const [id, tool] of Object.entries(dsl.tools)) {
    if (tool.guardrails) {
      for (const ref of tool.guardrails) {
        checkExists(ref, guardrailIds, "guardrails", `tools.${id}.guardrails`, "entity-guardrail-ref-not-found");
      }
    }
  }

  for (const [id, art] of Object.entries(dsl.artifacts)) {
    if (art.guardrails) {
      for (const ref of art.guardrails) {
        checkExists(ref, guardrailIds, "guardrails", `artifacts.${id}.guardrails`, "entity-guardrail-ref-not-found");
      }
    }
  }

  for (const [id, guardrail] of Object.entries(dsl.guardrails)) {
    if (guardrail.scope.agents) {
      for (const ref of guardrail.scope.agents) {
        checkExists(
          ref,
          agentIds,
          "agents",
          `guardrails.${id}.scope.agents`,
          "guardrail-scope-ref-not-found",
        );
      }
    }
    if (guardrail.scope.tasks) {
      for (const ref of guardrail.scope.tasks) {
        checkExists(
          ref,
          taskIds,
          "tasks",
          `guardrails.${id}.scope.tasks`,
          "guardrail-scope-ref-not-found",
        );
      }
    }
    if (guardrail.scope.tools) {
      for (const ref of guardrail.scope.tools) {
        checkExists(
          ref,
          toolIds,
          "tools",
          `guardrails.${id}.scope.tools`,
          "guardrail-scope-ref-not-found",
        );
      }
    }
    if (guardrail.scope.artifacts) {
      for (const ref of guardrail.scope.artifacts) {
        checkExists(
          ref,
          artifactIds,
          "artifacts",
          `guardrails.${id}.scope.artifacts`,
          "guardrail-scope-ref-not-found",
        );
      }
    }
    if (guardrail.scope.workflows) {
      for (const ref of guardrail.scope.workflows) {
        checkExists(
          ref,
          workflowIds,
          "system.default_workflow_order",
          `guardrails.${id}.scope.workflows`,
          "guardrail-scope-ref-not-found",
        );
      }
    }
  }

  for (const [policyId, policy] of Object.entries(dsl.guardrail_policies)) {
    for (let i = 0; i < policy.rules.length; i++) {
      const rule = policy.rules[i];
      checkExists(
        rule.guardrail,
        guardrailIds,
        "guardrails",
        `guardrail_policies.${policyId}.rules[${i}].guardrail`,
        "guardrail-policy-ref-not-found",
      );
    }
  }

  const workflowDefinitionIds = new Set(Object.keys(dsl.workflow));

  if (dsl.team_interface) {
    const ti = dsl.team_interface;
    if (ti.accepts?.workflows) {
      for (const [wfKey, spec] of Object.entries(ti.accepts.workflows)) {
        const internalWf = spec.internal_workflow ?? wfKey;
        checkExists(
          internalWf,
          workflowDefinitionIds,
          "workflow",
          `team_interface.accepts.workflows.${wfKey}.internal_workflow`,
          "team-interface-workflow-not-found",
        );
        checkExists(
          spec.input_handoff,
          handoffKinds,
          "handoff_types",
          `team_interface.accepts.workflows.${wfKey}.input_handoff`,
          "team-interface-handoff-not-found",
        );
        checkExists(
          spec.output_handoff,
          handoffKinds,
          "handoff_types",
          `team_interface.accepts.workflows.${wfKey}.output_handoff`,
          "team-interface-handoff-not-found",
        );
      }
    }
    if (ti.exposes?.artifacts) {
      for (let i = 0; i < ti.exposes.artifacts.length; i++) {
        const artKey = ti.exposes.artifacts[i];
        checkExists(
          artKey,
          artifactIds,
          "artifacts",
          `team_interface.exposes.artifacts[${i}]`,
          "team-interface-artifact-not-found",
        );
      }
    }
  }

  return diagnostics;
}
