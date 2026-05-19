import type {
  Dsl,
  Agent,
  Task,
  Artifact,
  Tool,
  Validation,
  HandoffType,
  Workflow,
  Policy,
  Guardrail,
  GuardrailPolicy,
  System,
  SoftwareBinding,
} from "../schema/index.js";
import { resolveAllOf } from "../schema/index.js";
import type { LoadedBinding } from "../config/binding-loader.js";

export interface GlobalContext {
  system: Dsl["system"];
  agents: Dsl["agents"];
  tasks: Dsl["tasks"];
  artifacts: Dsl["artifacts"];
  tools: Dsl["tools"];
  validations: Dsl["validations"];
  handoff_types: Dsl["handoff_types"];
  workflow: Dsl["workflow"];
  policies: Dsl["policies"];
  guardrails: Dsl["guardrails"];
  guardrail_policies: Dsl["guardrail_policies"];
  [key: string]: unknown;
}

export interface GuardrailEnforcementEntry {
  guardrail_id: string;
  description: string;
  severity: string;
  action: string;
  scoped_agents: string[];
  scoped_tasks: string[];
  scoped_workflows: string[];
  scoped_tools: string[];
  scoped_artifacts: string[];
  allow_override: boolean;
  override_requires: string[];
  trigger: string | null;
  escalation: { target: string; condition?: string } | null;
}

export interface SystemContext {
  system: System;
  dsl: Dsl;
  guardrailEnforcement?: GuardrailEnforcementEntry[];
  bindings?: SoftwareBinding[];
  [key: string]: unknown;
}

export interface EntityGuardrailEntry {
  guardrail_id: string;
  description: string;
  rationale?: string;
  tags: string[];
  source: "entity" | "scope" | "both";
  severity?: string;
  action?: string;
}

export interface EntityValidationEntry {
  validation_id: string;
  kind: string;
  target_artifact: string;
  executor_type?: string;
  blocking: boolean;
  produces_evidence?: string;
}

export interface PerTaskContext {
  task: Task & { id: string };
  targetAgent: (Agent & { id: string }) | null;
  relatedGuardrails: EntityGuardrailEntry[];
  relatedValidations: EntityValidationEntry[];
  dsl: Dsl;
  [key: string]: unknown;
}

export interface PerArtifactContext {
  artifact: Artifact & { id: string };
  relatedTools: Dsl["tools"];
  relatedValidations: Dsl["validations"];
  producerAgents: Dsl["agents"];
  consumerAgents: Dsl["agents"];
  editorAgents: Dsl["agents"];
  createdInWorkflows: string[];
  relatedGuardrails: EntityGuardrailEntry[];
  dsl: Dsl;
  [key: string]: unknown;
}

export interface PerToolContext {
  tool: Tool & { id: string };
  invokableAgents: Dsl["agents"];
  inputArtifactDetails: Dsl["artifacts"];
  outputArtifactDetails: Dsl["artifacts"];
  relatedGuardrails: EntityGuardrailEntry[];
  relatedValidations: EntityValidationEntry[];
  dsl: Dsl;
  [key: string]: unknown;
}

export interface PerValidationContext {
  validation: Validation & { id: string };
  dsl: Dsl;
  [key: string]: unknown;
}

export interface PerHandoffTypeContext {
  handoff_type: HandoffType & { id: string };
  relatedTasks: Array<Task & { id: string }>;
  dsl: Dsl;
  [key: string]: unknown;
}

export interface PerWorkflowContext {
  workflow: Workflow & { id: string };
  relatedAgents: Dsl["agents"];
  relatedTasks: Array<(Task & Record<string, unknown>) & { id: string }>;
  relatedTools: Dsl["tools"];
  relatedArtifacts: Dsl["artifacts"];
  relatedValidations: Dsl["validations"];
  dsl: Dsl;
  [key: string]: unknown;
}

export interface PerPolicyContext {
  policy: Policy & { id: string };
  dsl: Dsl;
  [key: string]: unknown;
}

export interface PerGuardrailContext {
  guardrail: Guardrail & { id: string };
  dsl: Dsl;
  [key: string]: unknown;
}

export interface PerGuardrailPolicyContext {
  guardrail_policy: GuardrailPolicy & { id: string };
  dsl: Dsl;
  [key: string]: unknown;
}

export interface MergedBehavioralSpec {
  responsibilities: string[];
  constraints: string[];
  rules: Array<Record<string, unknown>>;
  anti_patterns: string[];
  escalation_criteria: Array<Record<string, unknown>>;
  execution_steps: Array<Record<string, unknown>>;
  completion_criteria: string[];
}

export interface DelegatableTaskView {
  id: string;
  description: string;
  target_agent: string;
  workflow: string;
  input_artifacts: string[];
  invocation_handoff: string;
  invocation_payload_keys: string[];
  result_handoff: string;
  result_payload_keys: string[];
}

export interface PerAgentContext {
  agent: (Agent & Record<string, unknown>) & { id: string };
  tasks: Array<(Task & Record<string, unknown>) & { id: string }>;
  receivableTasks: Array<(Task & Record<string, unknown>) & { id: string }>;
  delegatableTasks: DelegatableTaskView[];
  relatedArtifacts: Dsl["artifacts"];
  relatedTools: Dsl["tools"];
  relatedHandoffTypes: Dsl["handoff_types"];
  mergedBehavior: MergedBehavioralSpec;
  relatedGuardrails: EntityGuardrailEntry[];
  relatedValidations: EntityValidationEntry[];
  dsl: Dsl;
  [key: string]: unknown;
}

export function buildGlobalContext(dsl: Dsl): GlobalContext {
  return {
    system: dsl.system,
    agents: dsl.agents,
    tasks: dsl.tasks,
    artifacts: dsl.artifacts,
    tools: dsl.tools,
    validations: dsl.validations,
    handoff_types: dsl.handoff_types,
    workflow: dsl.workflow,
    policies: dsl.policies,
    guardrails: dsl.guardrails,
    guardrail_policies: dsl.guardrail_policies,
  };
}

export function buildSystemContext(
  dsl: Dsl,
  options?: { loadedBindings?: LoadedBinding[]; activeGuardrailPolicy?: string },
): SystemContext {
  const ctx: SystemContext = { system: dsl.system, dsl };

  if (options?.loadedBindings && options.loadedBindings.length > 0) {
    ctx.bindings = options.loadedBindings.map((lb) => lb.binding);

    const policyName = options.activeGuardrailPolicy;
    const policy = policyName ? dsl.guardrail_policies[policyName] : undefined;

    if (policy) {
      ctx.guardrailEnforcement = buildGuardrailEnforcement(dsl, policy, options.loadedBindings);
    }
  }

  return ctx;
}

function buildGuardrailEnforcement(
  dsl: Dsl,
  policy: GuardrailPolicy,
  loadedBindings: LoadedBinding[],
): GuardrailEnforcementEntry[] {
  const entries: GuardrailEnforcementEntry[] = [];

  const bindingTriggers = new Map<string, string>();
  for (const lb of loadedBindings) {
    const impl = lb.binding.guardrail_impl ?? {};
    for (const [guardrailId, gi] of Object.entries(impl)) {
      for (const check of gi.checks) {
        if (check.matcher) {
          bindingTriggers.set(guardrailId, check.matcher.type);
        }
      }
    }
  }

  for (const rule of policy.rules) {
    const guardrail = dsl.guardrails[rule.guardrail];
    if (!guardrail) continue;

    const scope = guardrail.scope ?? {};
    entries.push({
      guardrail_id: rule.guardrail,
      description: guardrail.description,
      severity: rule.severity,
      action: rule.action,
      scoped_agents: scope.agents ?? [],
      scoped_tasks: scope.tasks ?? [],
      scoped_workflows: scope.workflows ?? [],
      scoped_tools: scope.tools ?? [],
      scoped_artifacts: scope.artifacts ?? [],
      allow_override: rule.allow_override,
      override_requires: rule.override_requires ?? [],
      trigger: bindingTriggers.get(rule.guardrail) ?? null,
      escalation: rule.escalation
        ? { target: rule.escalation.target, condition: rule.escalation.condition }
        : null,
    });
  }

  return entries;
}

type EntityType = "agents" | "tasks" | "tools" | "artifacts";

export function resolveEffectiveGuardrails(
  dsl: Dsl,
  entityType: EntityType,
  entityId: string,
): EntityGuardrailEntry[] {
  const entityDef = (dsl[entityType] as Record<string, { guardrails?: string[] }>)[entityId];
  const entitySide = new Set<string>(entityDef?.guardrails ?? []);

  const scopeSide = new Set<string>();
  for (const [guardrailId, guardrail] of Object.entries(dsl.guardrails)) {
    const scopeIds = guardrail.scope[entityType] as string[] | undefined;
    if (scopeIds?.includes(entityId)) {
      scopeSide.add(guardrailId);
    }
  }

  const allIds = new Set([...entitySide, ...scopeSide]);

  const activePolicyRules = new Map<string, { severity: string; action: string }>();
  for (const policy of Object.values(dsl.guardrail_policies)) {
    for (const rule of policy.rules) {
      if (!activePolicyRules.has(rule.guardrail)) {
        activePolicyRules.set(rule.guardrail, {
          severity: rule.severity,
          action: rule.action,
        });
      }
    }
  }

  const entries: EntityGuardrailEntry[] = [];
  for (const id of allIds) {
    const guardrail = dsl.guardrails[id];
    if (!guardrail) continue;

    const fromEntity = entitySide.has(id);
    const fromScope = scopeSide.has(id);
    const source: "entity" | "scope" | "both" =
      fromEntity && fromScope ? "both" : fromEntity ? "entity" : "scope";

    const policyInfo = activePolicyRules.get(id);
    entries.push({
      guardrail_id: id,
      description: guardrail.description,
      rationale: guardrail.rationale,
      tags: guardrail.tags,
      source,
      severity: policyInfo?.severity,
      action: policyInfo?.action,
    });
  }

  return entries;
}

function validationToEntityEntry(
  validationId: string,
  validation: Validation,
): EntityValidationEntry {
  return {
    validation_id: validationId,
    kind: validation.kind,
    target_artifact: validation.target_artifact,
    executor_type: validation.executor_type,
    blocking: validation.blocking,
    produces_evidence: validation.produces_evidence,
  };
}

/**
 * Resolves validation IDs for an agent, task, or tool into full entries for prompts.
 * For tools, includes validations where executor_type is "tool" and executor is the tool id.
 */
export function resolveEntityValidations(
  dsl: Dsl,
  entityType: "agents" | "tasks" | "tools",
  entityId: string,
): EntityValidationEntry[] {
  if (entityType === "agents") {
    const agent = dsl.agents[entityId];
    if (!agent) return [];
    const entries: EntityValidationEntry[] = [];
    for (const vid of agent.can_perform_validations ?? []) {
      const v = dsl.validations[vid];
      if (v) entries.push(validationToEntityEntry(vid, v));
    }
    return entries;
  }

  if (entityType === "tasks") {
    const task = dsl.tasks[entityId];
    if (!task) return [];
    const entries: EntityValidationEntry[] = [];
    for (const vid of task.validations ?? []) {
      const v = dsl.validations[vid];
      if (v) entries.push(validationToEntityEntry(vid, v));
    }
    return entries;
  }

  const entries: EntityValidationEntry[] = [];
  for (const [vid, v] of Object.entries(dsl.validations)) {
    if (v.executor_type === "tool" && v.executor === entityId) {
      entries.push(validationToEntityEntry(vid, v));
    }
  }
  entries.sort((a, b) => a.validation_id.localeCompare(b.validation_id));
  return entries;
}

export function buildTaskContext(
  dsl: Dsl,
  taskId: string,
): PerTaskContext {
  const taskDef = dsl.tasks[taskId];
  const task = { ...taskDef, id: taskId } as Task & { id: string };
  const agentDef = dsl.agents[taskDef.target_agent];
  const targetAgent = agentDef
    ? ({ ...agentDef, id: taskDef.target_agent } as Agent & { id: string })
    : null;
  const relatedGuardrails = resolveEffectiveGuardrails(dsl, "tasks", taskId);
  const relatedValidations = resolveEntityValidations(dsl, "tasks", taskId);
  return { task, targetAgent, relatedGuardrails, relatedValidations, dsl };
}

export function buildArtifactContext(
  dsl: Dsl,
  artifactId: string,
): PerArtifactContext {
  const artifactDef = dsl.artifacts[artifactId];
  const artifact = { ...artifactDef, id: artifactId } as Artifact & { id: string };

  const relatedTools: Dsl["tools"] = {};
  for (const [id, tool] of Object.entries(dsl.tools)) {
    if (
      tool.input_artifacts.includes(artifactId) ||
      tool.output_artifacts.includes(artifactId)
    ) {
      relatedTools[id] = tool;
    }
  }

  const relatedValidations: Dsl["validations"] = {};
  for (const [id, val] of Object.entries(dsl.validations)) {
    if (val.target_artifact === artifactId) {
      relatedValidations[id] = val;
    }
  }

  const pickAgents = (ids: string[]): Dsl["agents"] => {
    const result: Dsl["agents"] = {};
    for (const id of ids) {
      if (dsl.agents[id]) result[id] = dsl.agents[id];
    }
    return result;
  };

  const producerAgents = pickAgents(artifactDef.producers);
  const consumerAgents = pickAgents(artifactDef.consumers);
  const editorAgents = pickAgents(artifactDef.editors);

  const createdInWorkflows: string[] = [];
  for (const [_taskId, task] of Object.entries(dsl.tasks)) {
    if (createdInWorkflows.includes(task.workflow)) continue;
    const targetAgent = dsl.agents[task.target_agent];
    if (targetAgent?.can_write_artifacts.includes(artifactId)) {
      createdInWorkflows.push(task.workflow);
      continue;
    }
    const steps = task.execution_steps ?? [];
    for (const step of steps) {
      if (
        (step as Record<string, unknown>)["produces_artifact"] === artifactId
      ) {
        createdInWorkflows.push(task.workflow);
        break;
      }
    }
  }

  const relatedGuardrails = resolveEffectiveGuardrails(dsl, "artifacts", artifactId);

  return {
    artifact,
    relatedTools,
    relatedValidations,
    producerAgents,
    consumerAgents,
    editorAgents,
    createdInWorkflows,
    relatedGuardrails,
    dsl,
  };
}

export function buildToolContext(
  dsl: Dsl,
  toolId: string,
): PerToolContext {
  const toolDef = dsl.tools[toolId];
  const tool = { ...toolDef, id: toolId } as Tool & { id: string };

  const invokableAgents: Dsl["agents"] = {};
  for (const agentId of toolDef.invokable_by) {
    if (dsl.agents[agentId]) invokableAgents[agentId] = dsl.agents[agentId];
  }

  const pickArtifacts = (ids: string[]): Dsl["artifacts"] => {
    const result: Dsl["artifacts"] = {};
    for (const id of ids) {
      if (dsl.artifacts[id]) result[id] = dsl.artifacts[id];
    }
    return result;
  };

  const relatedGuardrails = resolveEffectiveGuardrails(dsl, "tools", toolId);
  const relatedValidations = resolveEntityValidations(dsl, "tools", toolId);

  return {
    tool,
    invokableAgents,
    inputArtifactDetails: pickArtifacts(toolDef.input_artifacts),
    outputArtifactDetails: pickArtifacts(toolDef.output_artifacts),
    relatedGuardrails,
    relatedValidations,
    dsl,
  };
}

export function buildValidationContext(
  dsl: Dsl,
  validationId: string,
): PerValidationContext {
  const validationDef = dsl.validations[validationId];
  const validation = { ...validationDef, id: validationId } as Validation & { id: string };
  return { validation, dsl };
}

export function buildHandoffTypeContext(
  dsl: Dsl,
  handoffTypeId: string,
): PerHandoffTypeContext {
  const htDef = dsl.handoff_types[handoffTypeId];
  const handoff_type = { ...htDef, id: handoffTypeId } as HandoffType & { id: string };
  const relatedTasks = Object.entries(dsl.tasks)
    .filter(
      ([, t]) =>
        t.invocation_handoff === handoffTypeId ||
        t.result_handoff === handoffTypeId,
    )
    .map(([id, t]) => ({ ...t, id }) as Task & { id: string });
  return { handoff_type, relatedTasks, dsl };
}

export function buildWorkflowContext(
  dsl: Dsl,
  workflowId: string,
): PerWorkflowContext {
  const wfDef = dsl.workflow[workflowId];
  const workflow = { ...wfDef, id: workflowId } as Workflow & { id: string };

  const stepReferencedTaskIds = new Set<string>();
  for (const step of wfDef.steps) {
    if (step.type === "delegate") {
      stepReferencedTaskIds.add(step.task);
      if (step.retry) {
        stepReferencedTaskIds.add(step.retry.fix_task);
        if (step.retry.revalidate_task) stepReferencedTaskIds.add(step.retry.revalidate_task);
      }
    } else if (step.type === "handoff" && step.task) {
      stepReferencedTaskIds.add(step.task);
      if (step.retry) {
        stepReferencedTaskIds.add(step.retry.fix_task);
        if (step.retry.revalidate_task) stepReferencedTaskIds.add(step.retry.revalidate_task);
      }
    }
  }

  const relatedTasks = Object.entries(dsl.tasks)
    .filter(([id, t]) => t.workflow === workflowId || stepReferencedTaskIds.has(id))
    .map(([id, t]) => ({ ...t, id }) as (Task & Record<string, unknown>) & { id: string });

  const agentIds = new Set<string>();
  for (const task of relatedTasks) {
    agentIds.add(task.target_agent);
    for (const fromAgent of task.allowed_from_agents) {
      agentIds.add(fromAgent);
    }
  }
  for (const step of wfDef.steps) {
    if (step.type === "delegate") {
      agentIds.add(step.from_agent);
    } else if (step.type === "handoff" && step.from_agent) {
      agentIds.add(step.from_agent);
    }
    if (step.type === "validation") {
      const val = dsl.validations[step.validation];
      if (val?.executor_type === "agent" && val.executor) {
        agentIds.add(val.executor);
      }
    }
  }

  const relatedAgents: Dsl["agents"] = {};
  for (const id of agentIds) {
    if (dsl.agents[id]) relatedAgents[id] = dsl.agents[id];
  }

  const toolIds = new Set<string>();
  for (const id of agentIds) {
    const agent = dsl.agents[id];
    if (agent) {
      for (const toolId of agent.can_execute_tools) {
        toolIds.add(toolId);
      }
    }
  }
  for (const task of relatedTasks) {
    for (const step of task.execution_steps ?? []) {
      if (step.uses_tool) toolIds.add(step.uses_tool);
    }
  }
  const relatedTools: Dsl["tools"] = {};
  for (const id of toolIds) {
    if (dsl.tools[id]) relatedTools[id] = dsl.tools[id];
  }

  const artifactIds = new Set<string>();
  for (const task of relatedTasks) {
    for (const artId of task.input_artifacts) artifactIds.add(artId);
    for (const step of task.execution_steps ?? []) {
      if (step.produces_artifact) artifactIds.add(step.produces_artifact);
      if (step.reads_artifact) artifactIds.add(step.reads_artifact);
    }
  }
  for (const id of agentIds) {
    const agent = dsl.agents[id];
    if (agent) {
      for (const artId of agent.can_read_artifacts) artifactIds.add(artId);
      for (const artId of agent.can_write_artifacts) artifactIds.add(artId);
    }
  }
  const relatedArtifacts: Dsl["artifacts"] = {};
  for (const id of artifactIds) {
    if (dsl.artifacts[id]) relatedArtifacts[id] = dsl.artifacts[id];
  }

  const validationIds = new Set<string>();
  for (const step of wfDef.steps) {
    if (step.type === "validation") {
      validationIds.add(step.validation);
    }
  }
  for (const task of relatedTasks) {
    for (const valId of task.validations ?? []) {
      validationIds.add(valId);
    }
  }
  const relatedValidations: Dsl["validations"] = {};
  for (const id of validationIds) {
    if (dsl.validations[id]) relatedValidations[id] = dsl.validations[id];
  }

  return {
    workflow,
    relatedAgents,
    relatedTasks,
    relatedTools,
    relatedArtifacts,
    relatedValidations,
    dsl,
  };
}

export function buildPolicyContext(
  dsl: Dsl,
  policyId: string,
): PerPolicyContext {
  const policyDef = dsl.policies[policyId];
  const policy = { ...policyDef, id: policyId } as Policy & { id: string };
  return { policy, dsl };
}

export function buildGuardrailContext(
  dsl: Dsl,
  guardrailId: string,
): PerGuardrailContext {
  const guardrailDef = dsl.guardrails[guardrailId];
  const guardrail = { ...guardrailDef, id: guardrailId } as Guardrail & {
    id: string;
  };
  return { guardrail, dsl };
}

export function buildGuardrailPolicyContext(
  dsl: Dsl,
  policyId: string,
): PerGuardrailPolicyContext {
  const policyDef = dsl.guardrail_policies[policyId];
  const guardrail_policy = { ...policyDef, id: policyId } as GuardrailPolicy & {
    id: string;
  };
  return { guardrail_policy, dsl };
}

function mergeRules(
  agentRules: Array<Record<string, unknown>>,
  taskRules: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const result = [...agentRules];
  const existingIds = new Set(result.map((r) => r["id"]));

  for (const rule of taskRules) {
    const id = rule["id"] as string;
    if (existingIds.has(id)) {
      const idx = result.findIndex((r) => r["id"] === id);
      result[idx] = rule;
    } else {
      result.push(rule);
    }
  }
  return result;
}

function mergeBehavioralSpec(
  agent: Agent,
  tasks: Task[],
): MergedBehavioralSpec {
  let responsibilities = agent.responsibilities ?? [];
  let constraints = agent.constraints ?? [];
  let rules = (agent.rules ?? []) as Array<Record<string, unknown>>;
  let antiPatterns = agent.anti_patterns ?? [];
  let escalation = (agent.escalation_criteria ?? []) as Array<Record<string, unknown>>;
  let executionSteps: Array<Record<string, unknown>> = [];
  let completionCriteria: string[] = [];

  for (const task of tasks) {
    responsibilities = [...responsibilities, ...(task.responsibilities ?? [])];
    constraints = [...constraints, ...(task.constraints ?? [])];
    rules = mergeRules(rules, (task.rules ?? []) as Array<Record<string, unknown>>);
    antiPatterns = [...antiPatterns, ...(task.anti_patterns ?? [])];
    escalation = [...escalation, ...(task.escalation_criteria ?? []) as Array<Record<string, unknown>>];
    executionSteps = [...executionSteps, ...((task.execution_steps ?? []) as Array<Record<string, unknown>>)];
    completionCriteria = [...completionCriteria, ...(task.completion_criteria ?? [])];
  }

  return {
    responsibilities,
    constraints,
    rules,
    anti_patterns: antiPatterns,
    escalation_criteria: escalation,
    execution_steps: executionSteps,
    completion_criteria: completionCriteria,
  };
}

/**
 * Extract top-level property names from a handoff type schema.
 * Flattens `allOf` before reading `properties`, so composed schemas
 * (via `$ref` + `allOf`) are handled correctly.
 */
function extractSchemaFieldNames(
  schema: Record<string, unknown>,
): string[] {
  const effective = resolveAllOf(schema);
  const props = effective["properties"];
  if (props && typeof props === "object") {
    return Object.keys(props as Record<string, unknown>);
  }
  return Object.keys(schema);
}

function buildDelegatableTasks(
  dsl: Dsl,
  agentId: string,
): DelegatableTaskView[] {
  return Object.entries(dsl.tasks)
    .filter(([, t]) => t.allowed_from_agents.includes(agentId))
    .map(([taskId, t]) => {
      const invocationHandoff = dsl.handoff_types[t.invocation_handoff];
      const resultHandoff = dsl.handoff_types[t.result_handoff];
      return {
        id: taskId,
        description: t.description,
        target_agent: t.target_agent,
        workflow: t.workflow,
        input_artifacts: t.input_artifacts,
        invocation_handoff: t.invocation_handoff,
        invocation_payload_keys: invocationHandoff
          ? extractSchemaFieldNames(invocationHandoff.schema)
          : [],
        result_handoff: t.result_handoff,
        result_payload_keys: resultHandoff
          ? extractSchemaFieldNames(resultHandoff.schema)
          : [],
      };
    });
}

export function buildPerAgentContext(
  dsl: Dsl,
  agent: Agent & { id: string },
): PerAgentContext {
  const agentId = agent.id;
  const receivableTasks = Object.entries(dsl.tasks)
    .filter(([, t]) => t.target_agent === agentId)
    .map(([id, t]) => ({ ...t, id }) as (Task & Record<string, unknown>) & { id: string });
  const delegatableTasks = buildDelegatableTasks(dsl, agentId);

  const artifactIds = new Set([
    ...agent.can_read_artifacts,
    ...agent.can_write_artifacts,
  ]);
  const relatedArtifacts: Dsl["artifacts"] = {};
  for (const [id, art] of Object.entries(dsl.artifacts)) {
    if (artifactIds.has(id)) relatedArtifacts[id] = art;
  }

  const toolIdSet = new Set(agent.can_execute_tools);
  const relatedTools: Dsl["tools"] = {};
  for (const [id, tool] of Object.entries(dsl.tools)) {
    if (toolIdSet.has(id)) relatedTools[id] = tool;
  }

  const handoffKinds = new Set([
    ...agent.can_return_handoffs,
    ...receivableTasks.map((t) => t.invocation_handoff),
    ...receivableTasks.map((t) => t.result_handoff),
    ...delegatableTasks.map((t) => t.invocation_handoff),
    ...delegatableTasks.map((t) => t.result_handoff),
  ]);
  const relatedHandoffTypes: Dsl["handoff_types"] = {};
  for (const [kind, ht] of Object.entries(dsl.handoff_types)) {
    if (handoffKinds.has(kind)) relatedHandoffTypes[kind] = ht;
  }

  const rawReceivableTasks = receivableTasks.map(({ id: _id, ...rest }) => rest as Task);
  const mergedBehavior = mergeBehavioralSpec(agent, rawReceivableTasks);
  const relatedGuardrails = resolveEffectiveGuardrails(dsl, "agents", agentId);
  const relatedValidations = resolveEntityValidations(dsl, "agents", agentId);

  return {
    agent,
    tasks: receivableTasks,
    receivableTasks,
    delegatableTasks,
    relatedArtifacts,
    relatedTools,
    relatedHandoffTypes,
    mergedBehavior,
    relatedGuardrails,
    relatedValidations,
    dsl,
  };
}
