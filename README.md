
# agent-contracts

[![npm version](https://img.shields.io/npm/v/agent-contracts.svg)](https://www.npmjs.com/package/agent-contracts)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Design multi-agent systems as contracts.**

`agent-contracts` is a toolkit for declaratively defining multi-agent development workflows in **YAML DSL**, with **static validation, semantic linting, and prompt rendering**.

It is designed for teams that need more than “agents that happen to work”.
It helps you define, validate, and evolve:

- who each agent is
- what tasks can be delegated
- which artifacts exist and who owns them
- what validations are required
- how handoffs are structured
- how prompts are rendered from the design itself

Instead of letting workflow rules live only in prompts and code, `agent-contracts` makes the system **explicit, reviewable, and CI-checkable**.

---

## Why agent-contracts?

Most agent frameworks focus on **runtime execution**.

`agent-contracts` focuses on **design-time guarantees**.

As multi-agent systems grow, teams usually run into the same problems:

- agent responsibilities become ambiguous
- handoff rules drift across prompts
- artifact ownership is unclear
- validation logic is inconsistent
- prompts diverge from the intended workflow
- shared team conventions stop being enforceable

`agent-contracts` addresses this by treating your agent workflow as a **contract**, not just a set of prompts.

You can think of it as:

- **OpenAPI for multi-agent workflows**
- **a contract layer above runtime orchestration**
- **a source of truth for agent roles, handoffs, and artifact flows**

---

## Who this is for

`agent-contracts` is a strong fit for teams that build or operate:

- multi-agent coding workflows
- spec → implement → audit → release style pipelines
- internal agent platforms
- review-heavy or gate-heavy delivery processes
- agent systems where artifact ownership matters
- reusable team definitions shared across projects

Typical users include:

- platform teams standardizing agent workflows
- engineering teams building internal coding/review agents
- products that require explicit validation and handoff policies
- teams that want CI enforcement for agent design consistency

---

## Who this is not for

`agent-contracts` is probably **not** the right starting point if you want:

- a single-agent chatbot
- a quick prompt prototype
- an all-in-one hosted agent runtime
- built-in scheduling, memory, tracing, or hosting
- a purely code-first orchestration style with no declarative spec
- maximum flexibility with minimal process constraints

In short:

- if you want to **run agents quickly**, start with a runtime framework
- if you want to **design multi-agent systems that stay coherent over time**, use `agent-contracts`

---

## What makes it different?

`agent-contracts` does not try to replace every agent framework.

It occupies a different layer.

### Positioning

| Product / approach | Primary focus | Best fit | How `agent-contracts` differs |
|---|---|---|---|
| **OpenAI Agents SDK** | runtime execution with instructions, tools, and handoffs | apps built around agent runtime behavior | `agent-contracts` focuses on design contracts, static guarantees, and artifact relationships |
| **CrewAI** | agent/task workflow orchestration | teams that want runtime task execution in YAML | `agent-contracts` goes deeper on validation, ownership, inheritance, and renderable design specs |
| **AutoGen** | code-first multi-agent programming | research or custom orchestration flows | `agent-contracts` is more declarative, reviewable, and CI-oriented |
| **Google ADK style patterns** | choosing runtime interaction patterns | production systems built around runtime composition | `agent-contracts` is framework-agnostic and centered on workflow design as a contract |

The key distinction is simple:

> Other frameworks mainly answer: **How do I run these agents?**  
> `agent-contracts` answers: **What is the allowed structure of this agent system, and how do we keep it correct as it evolves?**

This positioning is consistent with common industry patterns: some frameworks center the agent runtime, others separate agent definition and task invocation, but `agent-contracts` is strongest as a **design-time contract layer** across those execution models.

---

## Quick Start

Define your system in a single YAML file:

```yaml
# agent-contracts.yaml
version: 1
system:
  id: my-project
  name: My Agent Workflow
  default_workflow_order: [design, implement]

agents:
  architect:
    role_name: "Architect"
    purpose: "Drive phases and delegate work"
    can_invoke_agents: [implementer]

  implementer:
    role_name: "Implementer"
    purpose: "Implement features based on specs"

tasks:
  implement-feature:
    description: "Delegate feature implementation"
    target_agent: implementer
    allowed_from_agents: [architect]
    workflow: implement
    input_artifacts: [spec-md]
    invocation_handoff: task-delegation
    result_handoff: implementation-result

artifacts:
  spec-md:
    type: document
    owner: architect
    producers: [architect]
    editors: [architect]
    consumers: [implementer]
    states: [draft, reviewed, approved]
````

Validate and generate:

````bash
agent-contracts validate
agent-contracts generate -c agent-contracts.config.yaml
````


A working example is available in [`sample/`](./sample), including:

* [`sample/agent-contracts.yaml`](./sample/agent-contracts.yaml)
* [`sample/agent-contracts.config.yaml`](./sample/agent-contracts.config.yaml)
* [`sample/templates`](./sample/templates)
* [`sample/output`](./sample/output)

A multi-team example is available in [`sample/multi-team/`](./sample/multi-team), demonstrating cross-team interface declaration and consumption.

---

## Core concepts

### Agent

An **Agent** defines who an execution entity is:

* role name
* purpose
* capabilities
* permissions
* constraints
* behavioral rules
* structured content sections (reference material, procedures, criteria)

### Task

A **Task** defines a delegatable unit of work:

* target agent
* allowed callers
* workflow
* input artifacts
* invocation/result handoffs
* task-specific execution expectations
* `model_class` — optional LLM capability requirement (`fast`, `standard`, `thinking`)

### Artifact

An **Artifact** defines the objects that move through the workflow:

* owner
* producers
* editors
* consumers
* states
* required validations
* visibility

### Tool

A **Tool** defines an invokable CLI/MCP tool:

* kind (cli, mcp, etc.)
* input/output artifacts
* invokable_by (which agents can use it)
* `extends` — inherit from a base tool definition
* `command` — single command name (alternative to `commands[]`)
* `commands` — structured list of sub-commands with `category`, `reads`, `writes`, and `purpose`

### Workflow

A **Workflow** defines a phase-level execution sequence:

* `description` — human-readable summary
* `entry_conditions`
* `trigger`
* `external_participants` — actors/participants outside the agent system (e.g., User, external advisory)
* ordered steps (`delegate`, `gate`, `team_task`, `decision`; legacy: `handoff`, `validation`)

Workflow steps support additional properties:

* `group` — consecutive steps with the same group are rendered as `par` (parallel) blocks in sequence diagrams
* `depends_on` — list of step task IDs that must complete before this step starts. When specified, the runtime can execute independent steps in parallel. When omitted, the step implicitly depends on all preceding steps (sequential execution)
* `max_retries` (delegate steps) — maximum number of full task re-executions (new sessions) allowed per step. Defaults to `0` (no retries), or `1` when a `retry` block is present
* `max_follow_ups` (delegate steps) — maximum number of lightweight same-session follow-up messages for output format corrections
* `retry` (delegate steps) — defines a conditional retry loop with `condition`, `fix_task`, and optional `revalidate_task`. These are rendered as recovery instructions in the LLM prompt
* `routing_key` (decision steps) — the field that determines branch selection. The legacy field `on` is still accepted but deprecated due to YAML 1.1 reserved word collision

### Validation

A **Validation** defines a verification step for an artifact:

* `target_artifact` — the artifact being verified
* `kind` — the type of verification (see below)
* `executor_type` — `tool` (automated) or `agent` (agent-driven)
* `executor` — the tool or agent that runs the validation
* `blocking` — whether the validation must pass before proceeding
* `produces_evidence` — optional artifact produced as evidence

#### Validation kinds

| Kind | Purpose | Example |
|------|---------|---------|
| `schema` | Structural schema check | JSON Schema validation, OpenAPI lint, SQL syntax |
| `mechanical` | Automated tool check | CLI linters, diff checks, coverage reports |
| `semantic` | Meaning-level review | Agent-based review of spec intent, plan coherence |
| `approval` | Human/agent sign-off gate | Architect approval before implementation |
| `provenance` | Source derivation verification | Confirm generated artifact derives from its canonical source (e.g., manifest from API contracts) |
| `traceability` | Cross-artifact link completeness | Verify every spec requirement reaches contracts, tests, and code |
| `fidelity` | Semantic faithfulness to source | Confirm tests actually verify spec intent, not just structural compliance |

`schema` and `mechanical` are best suited for automated checks via tools. `semantic`, `fidelity`, and `approval` are typically agent-driven. `provenance` and `traceability` can be either tool or agent-based depending on the verification complexity.

### Guardrail

A **Guardrail** declares a cross-cutting constraint:

* description — what is protected
* scope — which DSL entities it applies to (agents, tasks, tools, artifacts, workflows)
* rationale — why the constraint exists
* tags — classification for filtering
* exemptions — glob patterns or entity IDs exempt from the guardrail

### Guardrail Policy

A **Guardrail Policy** defines enforcement strategy for guardrails:

* rules — array of enforcement rules mapping guardrails to actions
* Each rule specifies: severity (`critical`/`mandatory`/`warning`/`info`), action (`block`/`warn`/`shadow`/`info`), override permissions
* `action` supports a conditional form for state-dependent enforcement: `{ default: "block", when: { maintenance: "shadow" } }`
* Available states are declared system-wide via `system.states`

### Handoff Type

A **Handoff Type** defines the schema for inter-agent messages:

* `schema` — a JSON Schema object describing the full message structure
* `description`
* `example`
* `version`

Schemas can use `allOf` with `$ref: "#/components/schemas/..."` to compose shared fields (e.g., common envelope) with type-specific properties.

### Components

**Components** provide reusable definitions, following the OpenAPI pattern:

* `components.schemas` — named JSON Schema fragments that can be referenced from anywhere via `$ref: "#/components/schemas/<name>"`

---

## Why teams adopt it

### 1. Explicit workflow design

Your architecture stops living only in prompts, code, and tribal knowledge.

### 2. Static guarantees before runtime

You can catch broken references, invalid ownership, missing validations, and workflow inconsistencies before execution.

### 3. Prompt generation from source of truth

Rendered prompts come from the same DSL that defines roles, tasks, artifacts, and policies.

### 4. Reuse across teams and projects

Shared base definitions can be extended safely with `extends`.

### 5. Better CI discipline

Design regressions become testable.

---

## Features

* **Declarative YAML DSL** for multi-agent development workflows
* **Agent `sections`** for embedding structured reference material, procedures, and criteria directly in agent definitions
* **Static schema validation**
* **Reference integrity checks**
* **Semantic linting**
* **Structured handoff definitions** with formal JSON Schema and `allOf` composition
* **Reusable schema components** via `components.schemas` and JSON Pointer `$ref`
* **Artifact ownership and lifecycle modeling**
* **Config-driven prompt rendering** with `skip_empty` support for conditional file generation
* **Variable substitution** via `${vars.xxx}` in DSL values
* **Inheritance with merge operators via `extends`**
* **Guardrail definitions** for cross-cutting process constraints
* **Guardrail policies** with configurable enforcement (block/warn/shadow/info)
* **State-dependent guardrail action** — `action` accepts a conditional form `{ default, when }` keyed by `system.states` for workspace-mode-aware enforcement
* **Software bindings** (DI) for tool-specific guardrail implementation (Cursor, Git, GitHub)
* **Guardrail generation** from DSL + policy + bindings via `generate guardrails`
* **Navigation index** — compile-time artifact-centric model mapping artifacts to operations, agent permissions, relations, and action routes
* **Artifact coverage** — measure what percentage of project files are covered by artifact `path_patterns` definitions, with CI gating via `--min-coverage`
* **Tool `extends`** — tool inheritance for sharing `cli_contract`, `artifact_bindings`, and other metadata across related tool definitions
* **Interface generation** from DSL via `generate interface` for cross-team contracts
* **Flexible file splitting** via `$ref` (replacement), `$refs` (import + deep-merge), and JSON Pointer `$ref` (in-document)
* **Multi-team collaboration** via `team_interface` (public boundary), `imports` (team consumption), and `team_task` (cross-team delegation)
* **YAML safety linting** for reserved word collision detection across YAML 1.1/1.2
* **`extensions` declarations** with scope, schema validation, and strict enforcement for custom `x-*` fields
* **`resolve --expand-defaults`** to materialize all Zod schema defaults in output
* **DSL completeness scoring** with 7 dimensions, text/JSON output, and `--threshold` CI gate
* **LLM-based semantic audit** — design coherence, prompt fidelity, and completeness checks via Claude, OpenAI, Gemini, or Cursor adapters
* **JSON Schema for editor support and external tooling**
* **CI-friendly workflow checks**

---

## DSL structure

Entities are defined as **maps keyed by ID**.

````yaml
version: 1
extends: "./base/"

system:
  id: my-project
  name: My Agent Workflow
  default_workflow_order:
    - analyze
    - specify
    - plan
    - implement
    - audit
    - release
    - reflect
  states: []                       # optional — named workspace states for conditional guardrail action

agents: {}
tasks: {}
artifacts: {}
tools: {}
validations: {}
handoff_types: {}
team_interface:             # optional — multi-team public boundary
  version: 1
  accepts:
    workflows: {}
  exposes:
    artifacts: []
imports: {}                 # optional — consumed team interfaces
workflow: {}
policies: {}
guardrails: {}
guardrail_policies: {}
components:
  schemas: {}

extensions:
  x-flags:
    type: array
    items: string
    description: "CLI flags for tool commands"
  x-path-hint:
    type: string
    description: "Filesystem path hint"
    scope: [artifact]
    schema:
      type: string
      minLength: 1
    required: true
extensions_strict: false
````

This makes definitions easy to merge, extend, and reference by stable identifiers.

### Single-file format

````yaml
version: 1
system: { ... }
agents: { ... }
tasks: { ... }
artifacts: { ... }
````

### Multi-file format (section-level `$ref`)

````yaml
version: 1
extends: "./base/"
system:
  id: my-project
  name: My Agent Workflow
  default_workflow_order: [analyze, specify, plan, implement, audit, release, reflect]

agents: { $ref: "./agents.yaml" }
tasks: { $ref: "./tasks.yaml" }
artifacts: { $ref: "./artifacts.yaml" }
tools: { $ref: "./tools.yaml" }
validations: { $ref: "./validations.yaml" }
handoff_types: { $ref: "./handoff-types.yaml" }
workflow: { $ref: "./workflow.yaml" }
policies: { $ref: "./policies.yaml" }
````

### Per-entry `$ref`

`$ref` can be used at any object position. This allows splitting individual entries into separate files:

````yaml
agents:
  architect: { $ref: "./agents/architect.yaml" }
  implementer: { $ref: "./agents/implementer.yaml" }
  test-writer: { $ref: "./agents/test-writer.yaml" }
````

Each referenced file contains the agent definition directly (without the key):

````yaml
# agents/architect.yaml
role_name: "Architect"
purpose: "Drive phases and delegate work"
can_invoke_agents: [implementer]
````

### Directory `$ref`

When `$ref` points to a directory, all `*.yaml` / `*.yml` files in the directory are loaded and merged:

````yaml
agents: { $ref: "./agents/" }
````

Each file in the directory contains one or more keyed entries:

````yaml
# agents/architect.yaml
architect:
  role_name: "Architect"
  purpose: "Drive phases and delegate work"
````

Files are loaded in alphabetical order. Conflicting leaf values across files result in an error.

### `$refs` (import and merge)

`$refs` imports multiple files and **deep-merges** them into the containing map.
Unlike `$ref` (which replaces an object entirely), `$refs` allows mixing inline definitions with external files.

````yaml
agents:
  inline-agent:
    role_name: "Inline Agent"
    purpose: "Defined right here"
  $refs:
    - "./agents/architect.yaml"
    - "./agents/implementer.yaml"
    - "./more-agents/"           # directories are also supported
````

Each referenced file uses the same keyed format:

````yaml
# agents/architect.yaml
architect:
  role_name: "Architect"
  purpose: "Drive phases and delegate work"
````

`$refs` can also be used at the root level to compose a DSL from multiple aspect-oriented files:

````yaml
version: 1
system:
  id: my-project
  name: My Agent Workflow
  default_workflow_order: [analyze, implement]
$refs:
  - "./agents-core.yaml"        # agents + artifacts definitions
  - "./agents-constraints.yaml"  # constraints for the same agents
  - "./tasks.yaml"
````

Overlapping map keys are deep-merged recursively. Conflicting leaf values (scalar or array) result in an error.

| Directive | Type   | Behavior                                                 |
| --------- | ------ | -------------------------------------------------------- |
| `$ref`    | string | Replace the object at that position with file contents   |
| `$ref` (`#/...`) | string | Replace with the value at the given JSON Pointer path within the document |
| `$refs`   | array  | Import files and deep-merge into the containing map      |

### JSON Pointer `$ref`

`$ref` also supports **in-document references** using JSON Pointer syntax (RFC 6901).
When the value starts with `#/`, it resolves against the root document instead of the file system.

````yaml
components:
  schemas:
    handoff-common:
      type: object
      required: [from_agent, to_agent]
      properties:
        from_agent: { type: string }
        to_agent: { type: string }

handoff_types:
  task-delegation:
    version: 1
    schema:
      allOf:
        - $ref: "#/components/schemas/handoff-common"
        - type: object
          required: [payload]
          properties:
            payload:
              type: object
              required: [objective]
              properties:
                objective: { type: string }
````

This is particularly useful for sharing common schema fragments across multiple `handoff_types` entries via `components.schemas`.

JSON Pointer references are resolved in the same processing phase as file `$ref` — before Zod validation. They can be used anywhere in the document, not just within `handoff_types`.

---

## Example: Agent definition

````yaml
agents:
  main-architect:
    role_name: "Architect"
    purpose: "Drive phases, delegate, make gate decisions, integrate audits"
    dispatch_only: true
    mode: read-only
    can_read_artifacts:
      - spec-md
      - codebase
      - test-report
    can_write_artifacts:
      - review-note
    can_execute_tools:
      - spec-impact-check
    can_perform_validations:
      - evidence-gate-review
    can_invoke_agents:
      - implementer
      - test-writer
    can_return_handoffs:
      - evidence-gate-verdict

    responsibilities:
      - "Manage phase progression and gate decisions"
    constraints:
      - "Never write code directly"

    sections:
      - title: "Delegation Protocol"
        content: |
          You act as the Architect. You NEVER implement or test directly.
          Instead you delegate to specialist sub-agents.
````

---

## Example: Task definition

````yaml
tasks:
  implement-feature:
    description: "Delegate feature implementation"
    target_agent: implementer
    allowed_from_agents:
      - main-architect
    workflow: implement
    model_class: standard            # optional: fast | standard | thinking
    input_artifacts:
      - spec-md
      - plan-md
    invocation_handoff: task-delegation
    result_handoff: dependency-evidence
    responsibilities:
      - "Implement all requirements from spec-md"
    execution_steps:
      - id: read-specs
        action: "Read spec-md and design-docs"
        reads_artifact: spec-md
      - id: implement
        action: "Implement changes in codebase"
        produces_artifact: codebase
        depends_on: [read-specs]
      - id: run-db-lint
        action: "Run db-lint"
        uses_tool: db-lint
        x-timeout: 120
    completion_criteria:
      - "canonical artifacts updated"
````

`x-` prefixed custom properties work at any nesting level — including inside
`execution_steps`, `rules`, `workflow.steps`, and other nested objects.

### Extension declarations

Projects can declare their custom `x-*` extension fields in the DSL using `extensions`. This makes extensions discoverable, self-documenting, and — optionally — machine-validated:

````yaml
extensions:
  x-flags:
    type: array
    items: string
    description: "CLI flags for tool commands"
  x-path-hint:
    type: string
    description: "Filesystem path hint"
    scope: [artifact]
    schema:
      type: string
      minLength: 1
    required: true

extensions_strict: true  # undeclared x-* properties become errors
````

Each key must start with `x-` (validated at schema level). The declaration supports:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `type` | `string` | *(required)* | Informational type descriptor |
| `items` | `string` | — | Item type (for array-typed extensions) |
| `description` | `string` | — | Human-readable description |
| `scope` | `string[]` | all node types | Restricts which DSL node types this extension may appear on |
| `schema` | `object` | — | JSON Schema to validate the extension value |
| `required` | `boolean` | `false` | Whether the extension must be present on every in-scope entity |

**Scope values**: `root`, `system`, `agent`, `task`, `execution_step`, `artifact`, `tool`, `tool_command`, `validation`, `handoff_type`, `workflow`, `workflow_step`, `policy`, `guardrail`, `guardrail_policy`, `rule`, `escalation_criterion`, `prerequisite`

**`extensions_strict`**: When `true`, any `x-*` property not declared in `extensions` is an error. When `false` (default), undeclared extensions produce a warning.

**Diagnostics**:

| Code | Severity | Trigger |
|------|----------|---------|
| `extension-scope-mismatch` | error | Extension used on a node type outside its declared `scope` |
| `extension-schema-violation` | error | Extension value fails the declared JSON Schema |
| `extension-required-missing` | error | Required extension missing on an in-scope entity |
| `undeclared-extension` | warning/error | Extension not declared in `extensions` (error when `extensions_strict: true`) |

> **Backward compatibility:** `x-extensions` and `x-extensions-strict` are still accepted as deprecated aliases. They produce a `deprecated-property` warning and are normalized to `extensions` / `extensions_strict` during validation.

---

## Example: Artifact definition

````yaml
artifacts:
  spec-md:
    type: document
    description: "Specification document"
    owner: main-architect
    producers: [main-architect]
    editors: [main-architect]
    consumers: [implementer, test-writer]
    states: [draft, reviewed, approved]
    required_validations: [spec-semantic-review]
    visibility: internal
````

---

## artifact-contracts integration

agent-contracts integrates with [artifact-contracts](https://github.com/foo-log-inc/artifact-contracts) and [cli-contracts](https://github.com/foo-log-inc/cli-contracts) to provide a unified artifact governance model.

### Design principle

Relationships flow in one direction: **agent → artifact**.

- Agents declare which artifacts they own (`own_artifacts`), read (`can_read_artifacts`), or write (`can_write_artifacts`)
- Tools declare which abstract slots map to project artifacts (`artifact_bindings`)
- Artifact definitions themselves do not reference agents (the legacy `owner`/`producers`/`editors`/`consumers` fields are deprecated)

### How it works

**1. Define project artifacts** in `artifact-contracts.yaml` (project-specific):

````yaml
artifacts:
  api-specs:
    type: source
    authority: canonical
    path_patterns: ["specs/**/*.yaml"]
  api-contracts:
    type: generated-code
    authority: generated
    path_patterns: ["src/generated/**/*.ts"]
````

**2. Import artifacts** into your agent-contracts DSL via `$ref`:

````yaml
artifacts: { $ref: "./artifact-contracts.yaml#/artifacts" }
````

**3. cli-contracts define tools with domain-agnostic slot names** (reusable across projects):

````yaml
# cli-contract.yaml (tool's interface)
artifactSlots:
  source-specs:
    description: "Source specification files"
    direction: read
  contract-output:
    description: "Generated contract output"
    direction: write

commandSets:
  tool-name:
    commands:
      generate:
        summary: Generate contracts
        effects:
          reads: [source-specs]
          writes: [contract-output]
        exits:
          '0':
            description: Success
````

**4. Map abstract slots to project artifacts** using `artifact_bindings` on tools:

````yaml
tools:
  micro-contracts:
    kind: cli
    cli_contract: tools/micro-contracts/cli-contract.yaml
    artifact_bindings:
      source-specs: api-specs
      contract-output: api-contracts
````

**5. Agents reference tools and artifacts** directly:

````yaml
agents:
  architect:
    own_artifacts: [api-contracts, api-specs]
    can_read_artifacts: [api-specs, api-contracts]
    can_write_artifacts: [api-contracts]
    can_execute_tools: [micro-contracts]
````

### Validation and linting

- `own_artifacts` entries are validated to exist in the `artifacts` section
- `artifact_bindings` values are validated to exist in the `artifacts` section
- A lint rule warns if `own_artifacts` entries are not included in `can_read_artifacts`

---

## Example: Workflow definition

````yaml
workflow:
  specify:
    description: "Externalize requirements — create spec.md from user stories"
    entry_conditions:
      - User story or feature request received
    trigger: "User invokes /speckit.specify or asks to create a feature spec."
    steps:
      - type: delegate
        task: specify-feature
        from_agent: main-architect
      - type: validation
        validation: spec-semantic-review
      - type: decision
        routing_key: evidence-gate-verdict.verdict
        branches:
          PASS: [plan]
          REVISE: [specify-feature]
````

Decision steps use `routing_key` to specify the field that determines branching. The legacy `on` field is still accepted but deprecated — see [YAML safety](#yaml-safety) below.

---

## Example: Handoff type definition

Handoff types define the schema for inter-agent messages using JSON Schema.

````yaml
handoff_types:
  task-delegation:
    version: 1
    description: "Delegate a task to a sub-agent"
    schema:
      type: object
      required: [task, objective]
      properties:
        task: { type: string }
        objective: { type: string }
        constraints:
          type: array
          items: { type: string }
````

### Using `components.schemas` with `allOf`

Common fields (e.g., `from_agent`, `to_agent`, `run_id`) can be shared across handoff types by placing them in `components.schemas` and composing via `allOf`:

````yaml
components:
  schemas:
    handoff-common:
      type: object
      required: [from_agent, to_agent]
      properties:
        from_agent: { type: string }
        to_agent: { type: string }
        run_id: { type: string }

handoff_types:
  task-delegation:
    version: 1
    description: "Delegate a task"
    schema:
      allOf:
        - $ref: "#/components/schemas/handoff-common"
        - type: object
          required: [payload]
          properties:
            payload:
              type: object
              required: [objective]
              properties:
                objective: { type: string }

  implementation-result:
    version: 1
    description: "Return implementation results"
    schema:
      allOf:
        - $ref: "#/components/schemas/handoff-common"
        - type: object
          required: [payload]
          properties:
            payload:
              type: object
              required: [result]
              properties:
                result: { type: string }
                evidence:
                  type: array
                  items: { type: string }
````

The `$ref: "#/..."` references are resolved during loading, before validation. The resulting merged schema is then meta-validated as valid JSON Schema.

---

## Inheritance and merge operators

`agent-contracts` supports shared base definitions with project-level overrides through `extends`.

````yaml
extends: "./base/"

agents:
  implementer:
    constraints:
      $append:
        - "Use only approved external libraries"

  designer:
    role_name: "Designer"
    purpose: "UI design"

tasks:
  implement-feature:
    execution_steps:
      $insert_after:
        target: run-db-lint
        items:
          - id: run-contract-pipeline
            action: "Run contract pipeline"
            uses_tool: api-pipeline
````

Supported merge operators:

| Operator        | Behavior                                   |
| --------------- | ------------------------------------------ |
| `$append`       | Append entries to end of map/array         |
| `$prepend`      | Prepend entries to beginning of map/array  |
| `$insert_after` | Insert after element with specified key/id |
| `$replace`      | Replace entire value                       |
| `$remove`       | Remove entries by key/id                   |
| direct value    | Override scalar field                      |

---

## Multi-team collaboration

`agent-contracts` supports multi-team workflows where teams declare public interfaces and consume each other's capabilities.

### Team Interface

A `team_interface` declares what a team exposes to the outside:

````yaml
team_interface:
  version: 1
  description: "Backend team public interface"
  accepts:
    workflows:
      implement:
        internal_workflow: feature-implement
        input_handoff: feature-request
        output_handoff: implementation-result
        description: "Request a feature implementation"
  exposes:
    artifacts:
      - api-contract
      - build-report
  constraints:
    - "feature-request must include acceptance_criteria"
````

Key design decisions:

* **Workflow-level accepts** — external callers invoke a workflow, not individual tasks
* **Explicit mapping** — `internal_workflow` separates the stable public name from the internal workflow ID
* **Listing-based exposure** — an entity is external only if listed in `team_interface`

### Imports

A team consumes another team's generated interface via `imports`:

````yaml
imports:
  backend:
    interface: ./teams/backend/team-interface.yaml
    version: ">=1"
````

Imported entities are referenced as `{team_id}.{public_name}` in cross-team workflow steps.

### `team_task` workflow step

Cross-team delegation uses the `team_task` step type:

````yaml
workflow:
  execute-tests:
    steps:
      - type: team_task
        to_team: backend
        workflow: implement
        handoff: feature-request
        expects: implementation-result
        description: "Delegate implementation to backend team"
````

| Field | Description |
|-------|-------------|
| `to_team` | Team ID from `imports` |
| `workflow` | Public workflow name from the imported interface |
| `handoff` | Handoff type for the request |
| `expects` | Handoff type for the response |

### Generating a team interface

The `generate interface` command produces a self-contained `team-interface.yaml`:

````bash
agent-contracts generate interface -c agent-contracts.config.yaml
agent-contracts generate interface -c agent-contracts.config.yaml --team backend
agent-contracts generate interface -c agent-contracts.config.yaml -o custom-output.yaml
agent-contracts generate interface -c agent-contracts.config.yaml --dry-run
````

The output includes:

* Workflow entries with handoff key references
* A `handoff_types` section containing only schemas referenced by external workflows
* An `exposes.artifacts` section with type, description, and states
* Metadata (`team_id`, `team_name`, `version`, `generated_at`)

### Interface drift detection

The `check` command detects drift between the declared `team_interface` and the generated `team-interface.yaml`:

````bash
agent-contracts check -c agent-contracts.config.yaml
````

If a `team-interface.yaml` exists and differs from what would be regenerated, the check reports drift.

For managing multiple teams from a single configuration file (shared bindings, vars, and `--team` filtering), see [Multi-team configuration](#multi-team-configuration).

---

## Variable substitution

When using `extends` to share a base DSL across projects, base definitions often contain values that differ per project (project name, language, repository URL, etc.).

`vars` in `agent-contracts.config.yaml` lets you define project-specific values that are substituted into DSL string values using `${vars.xxx}` syntax.

### Defining vars

Add a `vars` section to your config file. Values must be flat string key-value pairs.

````yaml
# agent-contracts.config.yaml
vars:
  project_name: "my-service"
  language: "TypeScript"
  repo_url: "https://github.com/org/my-service"
````

### Using placeholders in DSL

Use `${vars.<key>}` in any string value within the DSL YAML (base or project).

````yaml
# base/agent-contracts.yaml
agents:
  implementer:
    purpose: "Implements features for ${vars.project_name}"
    constraints:
      - "Use ${vars.language} for all implementations"
      - "Repository: ${vars.repo_url}"
````

### Processing order

Variable substitution happens **after** DSL resolution (`extends` merge) and **before** schema validation:

1. Load config (including `vars`)
2. Resolve DSL (load + merge `extends`)
3. Substitute `${vars.xxx}` in all string values
4. Validate schema
5. Render / lint / check

This ensures that merged strings from both base and project are substituted, and the resulting values pass schema validation.

### Error handling

If a placeholder references an undefined variable, the command exits with an error:

````
VarsSubstitutionError: Undefined variable "repo_url" in value "Repository: ${vars.repo_url}"
  Defined vars: project_name, language
````

### Notes

- Only string values are substituted; object keys are not affected.
- `vars` is optional. If omitted, no substitution occurs.
- Patterns that do not match `${vars.<key>}` (e.g. `${env.HOME}`, `$vars.xxx`, `{{vars.xxx}}`) are left unchanged.

---

## CLI

For the full CLI reference with all commands, options, arguments, exit codes, and AI agent policies, see the [CLI Reference](docs/cli-reference.md).

The CLI contract specification is defined in [`cli-contract.yaml`](cli-contract.yaml) using [CLI Contracts](https://github.com/foo-log-inc/cli-contracts). Commands that have side effects declare structured `effects` metadata, and the `--introspect` global option outputs the derived policy as JSON without executing the command.

### Installation

````bash
npm install -g agent-contracts
npm install -D agent-contracts
npx agent-contracts
````

### Main commands

| Command                           | Description                                            |
| --------------------------------- | ------------------------------------------------------ |
| `agent-contracts resolve [path]`  | Resolve `extends` inheritance and output resolved YAML |
| `agent-contracts validate [path]` | Validate schema and references                         |
| `agent-contracts lint [path]`     | Run semantic lint                                      |
| `agent-contracts generate`        | Generate all artifacts (templates + guardrails + interface) |
| `agent-contracts generate templates` | Render template outputs from config                |
| `agent-contracts generate guardrails` | Generate guardrail artifacts from bindings       |
| `agent-contracts generate interface` | Generate team interface YAML from DSL            |
| `agent-contracts score [path]`    | Calculate DSL completeness score                       |
| `agent-contracts audit <type>`    | Run LLM-based semantic audit (render/dsl/prompt/all)   |
| `agent-contracts check`           | Run resolve → validate → lint → render --check         |
| `agent-contracts navigation-index` | Build artifact-centric navigation index |
| `agent-contracts artifact-coverage` | Measure file coverage by artifact definitions |
| `agent-contracts render`          | _(deprecated)_ Alias for `generate templates`          |

The `[path]` argument defaults to `agent-contracts.yaml` in the current directory.
If `-c` / `--config` is specified, the DSL path from the config file is used.

All commands also accept `--team <id>` to limit execution to a single team when using a [multi-team configuration](#multi-team-configuration).

#### `--introspect` (global)

Any command can be invoked with `--introspect` to output the derived policy as JSON **without executing** the command. This is useful for AI agents to inspect what side effects a command would have before deciding whether to run it.

````bash
agent-contracts generate --introspect
agent-contracts audit --introspect
agent-contracts validate --introspect
````

The output follows the [CLI Contracts](https://github.com/foo-log-inc/cli-contracts) `IntrospectionResult` shape:

````json
{
  "command": "generate",
  "activeOptions": ["format"],
  "policy": {
    "riskLevel": "low",
    "requiresConfirmation": false,
    "idempotent": true,
    "sideEffects": ["file_write"],
    "reads": [],
    "writes": [
      {
        "kind": "semantic",
        "target": "configured render, guardrail, and interface output paths",
        "idempotent": true,
        "source": "command:generate"
      }
    ]
  }
}
````

#### `resolve` options

| Option | Description |
|--------|-------------|
| `--format <text\|json>` | Output format (default: `text`) |
| `--expand-defaults` | Expand all Zod default values in output. Fields like `required_validations: []`, `tags: []`, and `can_read_artifacts: []` are written explicitly instead of being silently applied by schema defaults. |
| `-c, --config <path>` | Path to `agent-contracts.config.yaml` |
| `--team <id>` | Limit to one team (multi-team config only) |

#### `score` options

| Option | Description |
|--------|-------------|
| `--format <text\|json>` | Output format (default: `text`) |
| `--threshold <number>` | Minimum score; exit 1 if below (for CI gates) |
| `-c, --config <path>` | Path to `agent-contracts.config.yaml` |
| `--team <id>` | Limit to one team (multi-team config only) |

#### `audit` options

| Option | Description |
|--------|-------------|
| `--format <text\|json\|markdown>` | Output format (default: `text`) |
| `--scope <filter>` | Limit audit scope (e.g. `agents:architect,implementer`) |
| `--dry-run` | Output the audit prompt without calling the LLM |
| `--adapter <name>` | SDK adapter: `claude`, `openai`, `gemini`, `cursor` (overrides config) |
| `--model <name>` | LLM model override (overrides config) |
| `-c, --config <path>` | Path to `agent-contracts.config.yaml` |
| `--team <id>` | Limit to one team (multi-team config only) |

The `audit` command requires `agent-contracts-runtime` (optional peer dependency) to be installed. Configure the default adapter and model in `agent-contracts.config.yaml`:

```yaml
audit:
  adapter: openai
  model: gpt-4.1
```

#### `artifact-coverage` options

| Option | Description |
|--------|-------------|
| `--format <text\|json>` | Output format (default: `text`) |
| `--min-coverage <number>` | Minimum coverage %; exit 1 if below (for CI gates) |
| `-c, --config <path>` | Path to `agent-contracts.config.yaml` |
| `--team <id>` | Limit to one team (multi-team config only) |

Configure additional exclude patterns in `agent-contracts.config.yaml`:

```yaml
artifact_coverage:
  exclude_patterns:
    - "*.lock"
    - "**/*.snap"
    - ".cursor/**"
```

The score command evaluates 7 dimensions:

| Dimension | What it measures | Weight |
|-----------|-----------------|--------|
| Artifact validation coverage | % of artifacts with non-empty `required_validations` | High |
| Task validation coverage | % of tasks with at least one entry in `validations` | High |
| Guardrail policy coverage | % of guardrails referenced by at least one policy rule | Medium |
| Workflow validation integration | % of blocking validations referenced in workflow steps or tasks | High |
| Schema completeness | % of optional fields filled (description, rationale, trigger, etc.) | Low |
| Cross-reference bidirectionality | % of agent↔artifact, agent↔tool refs that are reciprocated | Medium |
| Guardrail scope resolution | % of guardrail scope entries that resolve to existing entities | Medium |

### Common usage

````bash
agent-contracts resolve
agent-contracts resolve --expand-defaults --format json
agent-contracts validate
agent-contracts lint --strict
agent-contracts score
agent-contracts score -c agent-contracts.config.yaml --threshold 70
agent-contracts score --format json
agent-contracts generate -c agent-contracts.config.yaml
agent-contracts generate templates -c agent-contracts.config.yaml
agent-contracts generate templates -c agent-contracts.config.yaml --check
agent-contracts check -c agent-contracts.config.yaml --strict
agent-contracts generate interface -c agent-contracts.config.yaml
agent-contracts generate interface -c agent-contracts.config.yaml --dry-run
agent-contracts generate interface -c agent-contracts.config.yaml --format json
agent-contracts audit dsl -c agent-contracts.config.yaml
agent-contracts audit render -c agent-contracts.config.yaml --format json
agent-contracts audit all -c agent-contracts.config.yaml --adapter claude
agent-contracts audit dsl -c agent-contracts.config.yaml --dry-run
agent-contracts navigation-index
agent-contracts navigation-index --format yaml
agent-contracts navigation-index --artifact api-contracts
agent-contracts artifact-coverage
agent-contracts artifact-coverage --format json
agent-contracts artifact-coverage --min-coverage 80
agent-contracts artifact-coverage -c agent-contracts.config.yaml
````

---

## Config-driven rendering

Rendering is configured via `agent-contracts.config.yaml`.

````yaml
dsl: ./agent-contracts.yaml

vars:
  project_name: "my-service"
  language: "TypeScript"
  repo_url: "https://github.com/org/my-service"

renders:
  - template: ./templates/agent-prompt.md.hbs
    context: agent
    output: ./output/{agent.id}.md

  - template: ./templates/overview.md.hbs
    context: system
    output: ./output/overview.md
````

This lets you generate static outputs for:

* agent prompts
* task specs
* overviews
* artifact docs
* validation docs
* workflow docs

all from the same resolved DSL.

### Multi-team configuration

When several teams (for example backend, QA, infra) are managed from one workspace, you can list every team in a single config file instead of maintaining separate configs.

This complements the DSL-level [multi-team collaboration](#multi-team-collaboration) features (`team_interface`, `imports`, `team_task`).

````yaml
teams:
  _defaults:
    bindings:
      - ./bindings/cursor.yaml
    vars:
      language: TypeScript
    paths:
      cursor_root: .cursor
    active_guardrail_policy: default-enforcement

  backend:
    dsl: ./teams/backend/agent-contracts.yaml
    interface_output: ./teams/backend/team-interface.yaml
    bindings:
      - ./teams/backend/bindings/observability.yaml
    vars:
      team_name: backend

  qa:
    dsl: ./teams/qa/agent-contracts.yaml
    vars:
      team_name: qa
````

**`_defaults`:** Reserved meta-entry in the `teams` map. It uses the same schema as team entries except `dsl` is not required. Values are inherited by all teams. The underscore prefix avoids colliding with real team IDs.

**Merge with `_defaults`:**

* `bindings` — `_defaults` bindings are prepended before team-specific bindings
* `vars` — shallow merge; team values win
* `paths` — shallow merge; team values win
* `active_guardrail_policy` — team wins when present

All commands accept `--team <id>` to run against a single team:

````bash
agent-contracts validate -c config.yaml              # all teams
agent-contracts validate -c config.yaml --team backend  # one team
agent-contracts check -c config.yaml --team qa          # one team
````

The `check` command also validates that imported interface files exist on disk (cross-team references).

**Design constraints:**

* `dsl` and `teams` are mutually exclusive at the config root
* Every team except `_defaults` must specify `dsl`
* Existing single-team configs (top-level `dsl` only) remain valid unchanged

### Render target options

Each entry in `renders` supports these fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `template` | string | yes | Path to Handlebars template |
| `context` | string | yes | Context type (see below) |
| `output` | string | yes | Output file path (supports `{<context>.id}` placeholder) |
| `include` | string[] | no | Only render these entity IDs (not with `system`) |
| `exclude` | string[] | no | Skip these entity IDs (not with `system`) |
| `skip_empty` | boolean | no | When `true`, if the rendered output is empty or whitespace-only, the file is **not written**. If the file already exists, it is **deleted**. |

#### `skip_empty` usage

`skip_empty` is useful when a single template applies to all entities of a context type, but only some entities produce meaningful output.

For example, when using `context: tool` to generate per-tool scripts, tools without an `x-script` property would produce empty files. With `skip_empty: true`, those files are simply not created:

````yaml
renders:
  - template: ./templates/tool-script.sh.hbs
    context: tool
    output: ./output/scripts/{tool.id}.sh
    skip_empty: true
````

````handlebars
{{!-- tool-script.sh.hbs --}}
{{#if tool.x-script}}
{{{tool.x-script}}}
{{/if}}
````

Tools with `x-script` get a generated script file; tools without it produce no file at all.

`skip_empty` also works with `generate templates --check` (drift detection): when the expected output is empty, the check expects the file to **not exist** and reports drift if it does.

### Available context types

Each `context` type provides a different rendering scope:

| Context | Scope | Output | Key variables |
|---------|-------|--------|---------------|
| `system` | Single file | `output` as-is | `system`, `dsl`, `guardrailEnforcement`\*, `bindings`\* |
| `navigation_index` | Single file | `output` as-is | `version`, `generated_at`, `system`, `artifacts` (full `ProjectNavigationIndex`) |
| `agent` | Per agent | `{agent.id}` in output path | `agent`, `receivableTasks`, `delegatableTasks`, `relatedArtifacts`, `relatedTools`, `relatedHandoffTypes`, `mergedBehavior`, `relatedGuardrails`, `relatedValidations`, `dsl` |
| `task` | Per task | `{task.id}` in output path | `task`, `targetAgent`, `relatedGuardrails`, `relatedValidations`, `dsl` |
| `artifact` | Per artifact | `{artifact.id}` in output path | `artifact`, `relatedTools`, `relatedValidations`, `relatedGuardrails`, `producerAgents`, `consumerAgents`, `editorAgents`, `createdInWorkflows`, `dsl` |
| `tool` | Per tool | `{tool.id}` in output path | `tool`, `invokableAgents`, `inputArtifactDetails`, `outputArtifactDetails`, `relatedGuardrails`, `relatedValidations`, `dsl` |
| `validation` | Per validation | `{validation.id}` in output path | `validation`, `dsl` |
| `handoff_type` | Per handoff type | `{handoff_type.id}` in output path | `handoff_type`, `relatedTasks`, `dsl` |
| `workflow` | Per workflow phase | `{workflow.id}` in output path | `workflow`, `relatedAgents`, `relatedTasks`, `relatedTools`, `relatedArtifacts`, `relatedValidations`, `dsl` |
| `policy` | Per policy | `{policy.id}` in output path | `policy`, `dsl` |
| `guardrail` | Per guardrail | `{guardrail.id}` in output path | `guardrail`, `dsl` |
| `guardrail_policy` | Per guardrail policy | `{guardrail_policy.id}` in output path | `guardrail_policy`, `dsl` |

#### Enriched context details

**`workflow` context** collects all entities involved in a phase:

* `relatedTasks` — tasks where `task.workflow` matches this phase
* `relatedAgents` — agents from task `target_agent`, `allowed_from_agents`, step `from_agent`, and validation executors
* `relatedTools` — tools from `can_execute_tools` of all related agents, plus `uses_tool` in execution steps
* `relatedArtifacts` — artifacts from `can_read_artifacts`, `can_write_artifacts`, `input_artifacts`, plus `produces_artifact` and `reads_artifact` in execution steps
* `relatedValidations` — validations referenced in workflow steps

**`artifact` context** provides ownership and cross-reference data:

* `relatedTools` — tools with this artifact in `input_artifacts` or `output_artifacts`
* `relatedValidations` — validations targeting this artifact
* `producerAgents` / `consumerAgents` / `editorAgents` — resolved agent records
* `createdInWorkflows` — workflow phases where this artifact is written

**`agent` context** provides merged behavioral specs and cross-references:

* `relatedGuardrails` — guardrails bound via `agent.guardrails[]` or guardrail `scope.agents[]`, merged and deduplicated
* `relatedValidations` — validations from `agent.can_perform_validations`, resolved into full entries (kind, target_artifact, executor_type, blocking)

**`task` context** provides execution details:

* `relatedGuardrails` — guardrails bound via `task.guardrails[]` or guardrail `scope.tasks[]`
* `relatedValidations` — validations from `task.validations[]`, resolved into full entries

**`tool` context** provides invocation and artifact details:

* `relatedGuardrails` — guardrails bound via `tool.guardrails[]` or guardrail `scope.tools[]`
* `relatedValidations` — validations where `executor_type` is `"tool"` and `executor` matches this tool ID
* `invokableAgents` — agents listed in `invokable_by`
* `inputArtifactDetails` / `outputArtifactDetails` — resolved artifact records

**`system` context** includes binding-aware guardrail enforcement data when `bindings` and `active_guardrail_policy` are configured:

* `guardrailEnforcement` — array of enforcement entries, each with `guardrail_id`, `description`, `severity`, `action`, scoped entities (`scoped_agents`, `scoped_tasks`, `scoped_workflows`, `scoped_tools`, `scoped_artifacts`), `allow_override`, `override_requires`, `trigger` (from binding matcher type), and `escalation`
* `bindings` — array of loaded `SoftwareBinding` objects

These fields are only populated when the config specifies `bindings` and `active_guardrail_policy`. Existing templates that do not reference these fields are unaffected.

**Matrix helpers** are available in `context: system` templates:

* `guardrailCoverageMatrix` — generates a Guardrail Coverage Matrix table (guardrail × severity × action × scoped entities × trigger × override × escalation)
* `taskGuardrailMatrix` — generates a Task × Guardrail cross-reference table showing which action applies to each task

### Handlebars helpers

Templates can use these built-in helpers:

| Helper | Usage | Description |
|--------|-------|-------------|
| `eq` | `{{#if (eq a b)}}` | Strict equality |
| `notEmpty` | `{{#if (notEmpty obj)}}` | True when object has at least one key |
| `inc` | `{{inc @index}}` | Increment number by 1 (for 1-based indexing) |
| `yamlBlock` | `{{{yamlBlock obj}}}` | Render value as YAML-formatted text |
| `jsonBlock` | `{{{jsonBlock obj}}}` | Render value as pretty-printed JSON |
| `yamlFrontmatter` | `{{{yamlFrontmatter obj}}}` | Render value as YAML frontmatter (`---` delimiters) |
| `handoffPayload` | `(handoffPayload handoffType)` | Resolve handoff payload (`example` or schema skeleton) |
| `handoffEnvelope` | `(handoffEnvelope handoffType id=@key)` | Build `{ type, version, payload }` envelope object |
| `lookupPayloadFields` | `{{#each (lookupPayloadFields schema)}}` | Extract schema field info (name, type, required, enum); resolves `allOf` internally |
| `join` | `{{join arr ", "}}` | Join array elements with separator |
| `contains` | `{{#if (contains arr "x")}}` | True when array includes value |
| `groupBy` | `{{#with (groupBy arr "key")}}` | Group array elements by field value |
| `filterByField` | `{{#each (filterByField arr "field" "val")}}` | Filter array by field match |
| `keys` | `{{#each (keys obj)}}` | Object keys as array |
| `values` | `{{#each (values obj)}}` | Object values as array |
| `size` | `{{size obj}}` | Array length or object key count |
| `not` | `{{#if (not x)}}` | Boolean negation |
| `or` | `{{#if (or a b)}}` | Boolean OR (variadic) |
| `and` | `{{#if (and a b)}}` | Boolean AND (variadic) |
| `gt` / `gte` / `lt` | `{{#if (gt a b)}}` | Numeric comparisons |
| `sequenceDiagram` | `{{{sequenceDiagram}}}` or `{{{sequenceDiagram @key ../dsl}}}` | Generate Mermaid sequence diagram. Supports `external_participants`, `group` (par blocks), `retry` (opt blocks), and read-only agent separation into Audit box |
| `overviewFlowchart` | `{{{overviewFlowchart dsl}}}` | Generate Mermaid graph showing phases → agents/tools/artifacts relationships (system context) |

---

## Guardrail DI system

`agent-contracts` includes a dependency injection system for guardrails that separates **what to protect** from **how to enforce** and **where to output**.

### Architecture

```text
agent-contracts.yaml (DSL)        agent-contracts.config.yaml
├─ guardrails:   (what + why)     ├─ bindings: [cursor.yaml, git.yaml, ...]
├─ guardrail_policies: (how)      ├─ active_guardrail_policy: default
└─ agents, tasks, ...             ├─ paths: {cursor_root: .cursor, ...}
                                  └─ vars, renders (existing)
```

### Guardrail definition

Guardrails declare constraints in the DSL without any implementation details:

````yaml
guardrails:
  no-force-push:
    description: "Force push to protected branches is forbidden"
    scope:
      tools: [git]
    rationale: "Force push destroys commit history"
    tags: [branch-protection, safety]
````

### Guardrail policy

Policies define enforcement strategies:

````yaml
guardrail_policies:
  default-enforcement:
    rules:
      - guardrail: no-force-push
        severity: critical
        action: block
      - guardrail: branch-lock
        severity: critical
        action:
          default: block
          when:
            maintenance: shadow
      - guardrail: english-only-code
        severity: warning
        action: warn
        allow_override: true
````

### Software bindings

Bindings define software-specific check implementations, output generation, and rendering:

````yaml
# bindings/cursor.yaml
software: cursor
version: 1

guardrail_impl:
  no-force-push:
    checks:
      - hook_event: beforeShellExecution
        matcher:
          type: command_regex
          pattern: "git\\s+push\\s+.*--force"
        message: "Force push is forbidden"

outputs:
  hook-script:
    target: "{cursor_root}/hooks/evaluate-hook.sh"
    mode: write
    executable: true
    template: ./templates/cursor-hook-wrapper.sh.hbs

renders:
  - context: agent
    output: "{cursor_root}/agent-team/{agent.id}.md"
    template: ./templates/agent-prompt.md.hbs
    exclude:
      - architect
  - context: system
    output: "{cursor_root}/rules/agent-team.mdc"
    inline_template: |
      {{#each agents}}
      - {{@key}}: {{this.role_name}}
      {{/each}}
````

### Binding inheritance

Binding files support `extends` for inheriting and extending a base binding, using the same mechanism as DSL-level `extends`.

A base binding defines shared guardrail implementations and outputs:

````yaml
# skeleton/bindings/cursor.yaml (base)
software: cursor
version: 1

guardrail_impl:
  no-force-push:
    checks:
      - hook_event: beforeShellExecution
        matcher:
          type: command_regex
          pattern: "git\\s+push\\s+.*--force"
        message: "Force push is forbidden"

outputs:
  policy-bundle:
    target: "{cursor_root}/guardrails/policy.json"
    mode: write
    inline_template: "{{json resolved_checks}}"
````

A project binding extends the base and adds project-specific guardrail implementations:

````yaml
# project/bindings/cursor.yaml
extends: ../../skeleton/bindings/cursor.yaml
software: cursor
version: 1

guardrail_impl:
  lint-on-save:
    checks:
      - hook_event: afterFileEdit
        matcher:
          type: file_glob
          pattern: "**/*.{ts,tsx}"
        message: "TS file edited — lint results attached."
````

The result is a single merged binding with all guardrail implementations from both base and project.

Merge behavior:

| Field | Behavior |
|-------|----------|
| `software` | Project wins |
| `guardrail_impl` | Map merge by guardrail ID (new IDs added; same ID deep-merged) |
| `outputs` | Map merge by output ID (project overrides base) |
| `renders` | Array concatenation (base renders + project renders) |
| `reporting` | Deep merge (project fields override base) |
| passthrough fields | Project wins |

All merge operators (`$append`, `$prepend`, `$insert_after`, `$replace`, `$remove`) work within binding `extends`, the same as DSL `extends`.

Chained inheritance (grandparent → parent → child) and both local path (`./`, `../`) and npm package references are supported. Circular extends are detected and rejected.

When using binding `extends`, the config only needs to list the child binding:

````yaml
# agent-contracts.config.yaml
bindings:
  - ./bindings/cursor.yaml    # extends base internally
  - ./bindings/git.yaml
````

### Config

````yaml
# agent-contracts.config.yaml
bindings:
  - ./bindings/cursor.yaml
  - ./bindings/git.yaml

active_guardrail_policy: default-enforcement

paths:
  cursor_root: .cursor
  git_hooks_root: scripts/git-hooks
````

### Binding template context

Both `outputs` and `renders` templates have access to the full binding generation context:

| Variable | Type | Description |
|----------|------|-------------|
| `system` | `{ id, name }` | System metadata |
| `guardrails` | `Record<string, Guardrail>` | All guardrail definitions |
| `policy` | `GuardrailPolicy` | Active guardrail policy |
| `binding` | `SoftwareBinding` | Current binding |
| `all_bindings` | `Record<string, SoftwareBinding>` | All loaded bindings |
| `vars` | `Record<string, string>` | Variables from `config.vars` |
| `paths` | `Record<string, string>` | Path variables from `config.paths` |
| `reporting` | `{ commands, fail_open, timeout_ms } \| null` | Reporting config |
| `resolved_checks` | `ResolvedCheck[]` | Resolved guardrail checks |
| `tasks` | `Record<string, Task>` | All DSL tasks |
| `artifacts` | `Record<string, Artifact>` | All DSL artifacts |
| `agents` | `Record<string, Agent>` | All DSL agents |
| `handoff_types` | `Record<string, HandoffType>` | All DSL handoff types |
| `workflow` | `Record<string, Workflow>` | All DSL workflows |

DSL entities include passthrough fields (`x-*` extensions), so custom metadata defined in the DSL is accessible in templates (e.g., `{{agents.implementer.x-team}}`).

### Binding renders

Binding `renders` provide entity-iteration rendering with full DSL context — the same capability as config-level `renders`, but defined within binding YAML files.

Each render target specifies a `context` type and an `output` path pattern:

| Field | Required | Description |
|-------|----------|-------------|
| `context` | yes | Entity type: `agent`, `task`, `artifact`, `tool`, `workflow`, `system`, etc. |
| `output` | yes | Output path with `{entity.id}` and `{paths_var}` expansion |
| `template` | one of | Path to external `.hbs` template file |
| `inline_template` | one of | Inline Handlebars template string |
| `include` | no | Only render these entity IDs |
| `exclude` | no | Skip these entity IDs |
| `skip_empty` | no | Delete target if rendered output is empty |
| `executable` | no | Set file permissions to 0755 |

For non-`system` contexts, one file is generated per entity (filtered by `include`/`exclude`). The output path supports two types of variable expansion:

- `{agent.id}`, `{task.id}`, etc. — replaced with the current entity ID
- `{cursor_root}`, `{observability_root}`, etc. — replaced from `config.paths`

**When to use binding renders vs config renders vs binding outputs:**

| Use case | Recommended |
|----------|-------------|
| Generate per-entity files (agent prompts, workflow docs) | Binding `renders` or config `renders` |
| Generate guardrail/policy runtime artifacts | Binding `outputs` |
| Generate files using DSL data + guardrail data | Binding `renders` (has both) |
| Simple config without bindings | Config `renders` |

Config `renders` remains supported and is not deprecated. Binding `renders` offers the advantage of co-locating templates with their binding definition and having access to the full binding context (`vars`, `paths`, `resolved_checks`, etc.) in addition to DSL entities.

### Generate command

````bash
agent-contracts generate guardrails -c agent-contracts.config.yaml
agent-contracts generate guardrails -c agent-contracts.config.yaml --binding cursor
agent-contracts generate guardrails -c agent-contracts.config.yaml --dry-run
````

---

## Validation model

`agent-contracts` validates your system in multiple layers.

### Schema validation

Checks:

* required fields
* types
* enums
* handoff schema shape (meta-validated as valid JSON Schema via ajv)
* `allOf` composition in handoff schemas
* invalid custom properties without `x-` prefix (checked at all nesting levels)
* `extensions` declaration validation — scope, schema, required, and undeclared checks
* `extensions_strict` enforcement — reject undeclared `x-*` properties when enabled

Custom properties with `x-` prefix are allowed on any object in the DSL — top-level entities (agents, tasks, artifacts, …), nested objects (rules, execution steps, workflow steps, …), and the root DSL itself.

### YAML safety

The DSL is expressed in YAML, which introduces risks from YAML 1.1's implicit type coercion. The `yaml-reserved-key-safety` lint rule warns when reserved words appear in positions that may be misinterpreted by non-1.2 parsers.

The most notable case is the `on` field in decision steps. In YAML 1.1, bare `on` as a mapping key is interpreted as boolean `true`. While `agent-contracts` uses a YAML 1.2 parser internally, DSL consumers (CI tools, editors, other parsers) may use YAML 1.1 parsers.

To address this:

* Decision steps now support `routing_key` as the preferred field name (replacing `on`)
* The legacy `on` field is still accepted for backward compatibility but triggers a lint warning
* Branch keys like `yes`, `no`, `true`, `false` also trigger warnings

````yaml
# Preferred — safe across all YAML versions
- type: decision
  routing_key: evidence-gate-verdict.verdict
  branches:
    PASS: [release]
    FAIL: [fix-violations]

# Deprecated — works but triggers yaml-reserved-key-safety warning
- type: decision
  on: evidence-gate-verdict.verdict
  branches:
    PASS: [release]
    FAIL: [fix-violations]
````

### Reference integrity

Checks:

* cross-entity references
* owner / producer / editor / consumer validity
* handoff schema consistency (`required` vs. `properties` alignment)
* permission alignment between agents and artifacts
* `team_interface` internal consistency (workflows, handoffs, and exposed artifacts exist in the DSL)
* cross-team reference validity (`team_task` targets exist in `imports`)

### Semantic lint

Checks:

* bidirectional consistency
* validation coverage — warns when artifacts lack validations or have empty `required_validations` (fails under `--strict`)
* artifact-required-validation wiring — verifies every entry in `artifact.required_validations` exists, targets the correct artifact, and is referenced in a workflow step or task
* task-output-validation completeness — checks that tasks producing artifacts (via `execution_steps.produces_artifact` or agent `can_write_artifacts`) cover those artifacts' `required_validations`
* workflow graph completeness
* merge integrity
* read-only write violations
* prerequisite readability
* artifact ownership — `produces_artifact`/`reads_artifact` in execution steps vs. artifact producers/editors/consumers
* tool commands — `commands[].reads`/`commands[].writes` reference valid artifacts and align with `output_artifacts`
* semantic validation phase coverage — warns when `semantic` or `fidelity` validations only appear in late workflow phases (e.g., audit) but not earlier phases (e.g., specify, plan)
* validation executor context wiring — warns when a validation's executor (agent or tool) exists in the DSL but the validation is not surfaced in the executor's prompt context
* YAML safety — warns when YAML 1.1 reserved words (`on`, `yes`, `no`, `true`, `false`, etc.) are used in positions where they may be misinterpreted by non-1.2 parsers
* naming/style issues through Spectral rules

#### `--strict` mode

When `--strict` is passed to `lint` or `check`, warnings are treated as failures (exit code 1). This is particularly relevant for artifact-centric validation rules — empty `required_validations`, orphaned validation wiring, and incomplete task coverage are all warnings that become blocking under `--strict`.

### Completeness scoring

`agent-contracts score` provides a quantitative assessment of the DSL's completeness. While `validate` checks structural correctness (pass/fail) and `lint` checks semantic quality (warnings/errors), `score` produces a **numeric metric** (0–100) covering validation coverage, schema completeness, cross-reference consistency, and more.

Use `--threshold` in CI to enforce a minimum quality bar:

````bash
agent-contracts score -c config.yaml --threshold 70
````

### LLM-based semantic audit

Static tools (`validate`, `lint`, `score`) catch structural and naming issues, but cannot evaluate **design quality** — whether agent responsibilities are well-scoped, whether workflow gates are placed correctly, or whether generated prompts faithfully represent DSL intent. The `audit` command bridges this gap by using LLMs as semantic reviewers.

Requires `agent-contracts-runtime` (optional peer dependency) and an API key for at least one supported adapter.

#### Audit types

| Type | What it checks |
|------|----------------|
| `render` | 19-dimension cross-check of DSL definitions vs generated prompts — detects template gaps, data gaps, and DSL gaps |
| `dsl` | Design coherence — role overlap, scope breadth, gate placement, guardrail enforcement paths, handoff schema completeness |
| `prompt` | Prompt fidelity — missing responsibilities, hallucinated permissions, ambiguous instructions, unsafe directives |
| `all` | Run all three |

Results are structured: each finding has a severity (`critical` / `warning` / `info`), a gap type classification, and prioritized recommendations (P0/P1/P2) with concrete fix proposals.

#### Configuration

````yaml
# agent-contracts.config.yaml
audit:
  adapter: openai      # claude | openai | gemini | cursor
  model: gpt-4.1       # model override (adapter-specific)
````

| Adapter | Environment Variable |
|---------|---------------------|
| `claude` | `ANTHROPIC_API_KEY` |
| `openai` | `OPENAI_API_KEY` |
| `gemini` | `GEMINI_API_KEY` |
| `cursor` | `CURSOR_API_KEY` |

#### Usage

````bash
agent-contracts audit dsl -c config.yaml
agent-contracts audit all -c config.yaml --adapter claude
agent-contracts audit render -c config.yaml --format json
agent-contracts audit dsl -c config.yaml --dry-run
````

Use `--dry-run` to inspect the prompt sent to the LLM without making an API call. Running multiple adapters provides cross-validation — findings reported by 3+ adapters are high-confidence issues.

| Exit Code | Meaning |
|-----------|---------|
| 0 | No critical findings |
| 1 | Critical findings detected |
| 2 | Invalid input or configuration |
| 3 | LLM adapter error (API failure, runtime not installed) |

#### A self-hosted example of agent-contracts + runtime

The audit feature is itself built on the agent-contracts ecosystem. The auditor agent, audit tasks, handoff schemas, and workflow are all defined as DSL in `dsl_base/`, and executed via `agent-contracts-runtime` adapters at runtime. This makes the audit command a concrete, working example of how to combine the two packages: define agent behavior declaratively in YAML, auto-generate typed registries, and execute tasks against real LLM adapters with structured output validation.

---

## Best used with runtime frameworks

`agent-contracts` works well alongside runtime frameworks and internal agent infrastructure.

A practical model is:

1. define the workflow in YAML
2. validate and lint it in CI
3. generate prompts and derived docs
4. execute the workflow in your runtime of choice

That separation keeps runtime concerns and architecture concerns from being mixed together.

---

## Tech stack

| Category       | Choice                             |
| -------------- | ---------------------------------- |
| Language       | TypeScript (ESM, strict mode)      |
| Schema         | Zod + ajv (JSON Schema meta-validation) |
| YAML parsing   | yaml                               |
| Lint           | TypeScript custom rules + Spectral |
| Templates      | Handlebars                         |
| CLI            | commander                          |
| Testing        | Vitest                             |
| Build          | tsup                               |

---

## License

MIT
