# Guardrail Definition & DI Binding Specification

**Version**: 0.2.0
**Date**: 2026-04-17
**Status**: Partially Implemented
**Prerequisite reading**: `guardrail-di-spec.md`, `shift-left-guidline.md`, `feasibility-study.md`, `ai-observ-agent-contracts-refactoring.md`

---

## 1. Overview

This specification adds first-class guardrail definitions and a Dependency Injection (DI) binding system to agent-contracts. The goals are:

1. Declare **what to protect** (`guardrails:`) and **how to enforce** (`guardrail_policies:`) as part of the DSL.
2. Define **software-specific implementations** in external binding files that are injected via config.
3. Generate runtime artifacts (hook scripts, CI workflows, event schemas) from the combination of DSL definitions, policies, and bindings.

### 1.1 Architecture

```text
agent-contracts.yaml (DSL)        agent-contracts.config.yaml
├─ guardrails:   (what + why)     ├─ bindings: [cursor.yaml, git.yaml, ...]
├─ guardrail_policies: (how)      ├─ active_guardrail_policy: default
└─ agents, tasks, ...             ├─ paths: {cursor_root: .cursor, ...}
                                  └─ vars, renders (existing)
        │                                  │
        └──────────┬───────────────────────┘
                   │
           ┌───────▼────────┐
           │  resolve + bind │
           └───────┬────────┘
                   │
    ┌──────────────┼──────────────┐
    ▼              ▼              ▼
cursor outputs  git outputs   observability outputs
(.cursor/...)   (scripts/...) (.observ/...)
```

### 1.2 Design Principles

| Principle | Description |
|-----------|-------------|
| **Binding = software knowledge** | Bindings define _what_ to output: check implementations, output formats, templates |
| **Config = project placement knowledge** | Config defines _where_ outputs go: root directories, path overrides |
| **Guardrail ≠ Policy** | Guardrails declare stable constraints; policies define variable enforcement strategies |
| **DSL scope = entity references only** | No command strings or regex patterns in the DSL; those belong in bindings |
| **Template duality** | Support both inline templates (short scripts) and external file references |
| **Observability engine records only** | The observability engine never evaluates guardrails; it receives execution result events |
| **State-dependent action** | `severity` is inherent to the guardrail and never changes; `action` can vary by workspace state declared in `system.states` |

### 1.3 Relationship to Existing Entities

Guardrails use a **bidirectional binding model** to associate with entities:

1. **Scope-side binding** (`guardrails[].scope`): The guardrail declares which entities it applies to. This is the cross-cutting direction — one guardrail targets many entities.
2. **Entity-side binding** (`entity.guardrails[]`): Each entity (agent, task, tool, artifact) declares which guardrails apply to it. This is the entity-specific direction — one entity opts into guardrails relevant to its context.

The effective guardrails for an entity are the **union** of both directions, deduplicated. Each resolved entry tracks its `source`: `"entity"` (declared on the entity), `"scope"` (declared on the guardrail), or `"both"`.

```
effectiveGuardrails(entityType, entityId) =
  Set(entity.guardrails ?? [])
  ∪ Set(guardrailId for each guardrail where scope.{entityType} includes entityId)
```

Resolved guardrails are injected into each entity's `PerEntityContext.relatedGuardrails` so templates can render them into prompts.

A parallel mechanism exists for validations: `resolveEntityValidations()` resolves validation IDs into `EntityValidationEntry[]` and injects them as `relatedValidations` into agent, task, and tool contexts. See Issue #19.

| Existing | Purpose | Guardrail Relation |
|----------|---------|-------------------|
| `agents[].rules` | Per-agent behavioral rules (mandatory/recommended/optional) | Guardrails are cross-cutting constraints that also support entity-side binding |
| `agents[].constraints` | Free-text agent constraints | Guardrails are machine-evaluable |
| `agents[].guardrails` | Entity-side guardrail binding | References guardrail IDs; merged with scope-side bindings |
| `policies` | Validation requirement policies (`when` → `requires_validations`) | `guardrail_policies` is a separate section for enforcement strategies |
| `validations` | Artifact validation definitions | Validations check artifact quality; guardrails enforce process constraints |

---

## 2. DSL Schema Extensions

### 2.1 `guardrails:` Section

Added to `DslSchema` as `z.record(z.string(), GuardrailSchema).default({})`.

A guardrail declares **what to protect** and **why**, without any enforcement or implementation details.

#### Schema Definition

```typescript
const GuardrailScopeSchema = z.object({
  agents: z.array(z.string()).optional(),
  tasks: z.array(z.string()).optional(),
  tools: z.array(z.string()).optional(),
  artifacts: z.array(z.string()).optional(),
  workflows: z.array(z.string()).optional(),
}).passthrough();

const GuardrailSchema = z.object({
  description: z.string(),
  scope: GuardrailScopeSchema,
  rationale: z.string().optional(),
  tags: z.array(z.string()).default([]),
  exemptions: z.array(z.string()).optional(),
}).passthrough();
```

#### Field Semantics

| Field | Required | Description |
|-------|----------|-------------|
| `description` | yes | Human-readable description of the constraint |
| `scope` | yes | References to DSL entities this guardrail applies to |
| `scope.agents` | no | Agent IDs this guardrail is relevant to |
| `scope.tasks` | no | Task IDs this guardrail is relevant to |
| `scope.tools` | no | Tool IDs this guardrail is relevant to |
| `scope.artifacts` | no | Artifact IDs this guardrail is relevant to |
| `scope.workflows` | no | Workflow IDs this guardrail is relevant to |
| `rationale` | no | Explanation of why this constraint exists |
| `tags` | no | Classification tags for filtering and grouping |
| `exemptions` | no | Glob patterns or entity IDs exempt from this guardrail |

`scope` fields reference DSL entity IDs only. They do not contain command strings, regex patterns, or file globs — those belong in binding `guardrail_impl` definitions.

#### Example

```yaml
guardrails:
  no-force-push:
    description: "Force push to protected branches is forbidden"
    scope:
      tools: [git]
    rationale: "Force push destroys commit history and breaks collaborator state"
    tags: [branch-protection, safety]

  no-rebase:
    description: "Rebase is prohibited"
    scope:
      tools: [git]
    rationale: "Rebase rewrites history; use merge instead"
    tags: [branch-protection, safety]

  english-only-code:
    description: "Source code must not contain Japanese characters"
    scope:
      artifacts: [source-code]
    rationale: "Constitution I requires English-only development artifacts"
    tags: [quality, i18n]
    exemptions:
      - "docs/**"
      - "*.md"

  test-before-commit:
    description: "All tests must pass before committing"
    scope:
      workflows: [implement]
    rationale: "Constitution X requires local verification before CI push"
    tags: [quality, testing]
```

### 2.1.1 Entity-side `guardrails` field

All entity schemas (`AgentSchema`, `TaskSchema`, `ToolSchema`, `ArtifactSchema`) accept an optional `guardrails: string[]` field referencing guardrail IDs. This is the entity-side of the bidirectional binding model described in §1.3.

```typescript
// Added to AgentSchema, TaskSchema, ToolSchema, ArtifactSchema:
guardrails: z.array(z.string()).optional()
```

Enforcement parameters (severity, action) remain in `guardrail_policies` — the entity only declares **what** applies. `WorkflowSchema` is excluded — workflows orchestrate steps rather than being direct guardrail targets.

```yaml
agents:
  implementer:
    guardrails: [english-only-code, test-before-commit]

tasks:
  implement-feature:
    guardrails: [ddl-workflow]

tools:
  code-editor:
    guardrails: [no-force-push, no-rebase]

artifacts:
  codebase:
    guardrails: [english-only-code, protect-generated-files]
```

For each entity, the effective guardrails are the union of `entity.guardrails[]` (entity-side) and `guardrails[].scope.{entity_type}` (scope-side), deduplicated. Each resolved entry tracks its `source`: `"entity"`, `"scope"`, or `"both"`. Results are injected into `PerEntityContext.relatedGuardrails` as `EntityGuardrailEntry[]`.

### 2.2 `guardrail_policies:` Section

Added to `DslSchema` as `z.record(z.string(), GuardrailPolicySchema).default({})`.

A guardrail policy defines **how to enforce** guardrails. It is separate from the existing `policies:` section, which handles validation requirements.

#### Schema Definition

```typescript
const EscalationSchema = z.object({
  target: z.string(),
  condition: z.string().optional(),
}).passthrough();

const ActionEnum = z.enum(["block", "warn", "shadow", "info"]);
const ConditionalActionSchema = z.object({
  default: ActionEnum,
  when: z.record(z.string(), ActionEnum),
});
const ActionSchema = z.union([ActionEnum, ConditionalActionSchema]);

const GuardrailPolicyRuleSchema = z.object({
  guardrail: z.string(),
  severity: z.enum(["critical", "mandatory", "warning", "info"]),
  action: ActionSchema,
  allow_override: z.boolean().default(false),
  override_requires: z.array(z.string()).optional(),
  escalation: EscalationSchema.optional(),
}).passthrough();

const GuardrailPolicySchema = z.object({
  description: z.string().optional(),
  rules: z.array(GuardrailPolicyRuleSchema),
}).passthrough();
```

#### Field Semantics

**GuardrailPolicySchema**:

| Field | Required | Description |
|-------|----------|-------------|
| `description` | no | Human-readable description of this policy |
| `rules` | yes | Array of enforcement rules |

**GuardrailPolicyRuleSchema**:

| Field | Required | Description |
|-------|----------|-------------|
| `guardrail` | yes | ID reference to a `guardrails` entry |
| `severity` | yes | `critical` / `mandatory` / `warning` / `info` |
| `action` | yes | Enforcement action. Accepts a simple string (`"block"`, `"warn"`, `"shadow"`, `"info"`) or an object `{ default, when }` for state-dependent behavior. When a string, the action always applies. When an object, `default` applies normally and `when` maps state names (from `system.states`) to override actions. |
| `allow_override` | no | Whether the action can be overridden (default: `false`) |
| `override_requires` | no | What is required to override (e.g., `["rationale"]`) |
| `escalation` | no | Escalation target and trigger condition |

#### Action Semantics

| Action | Hook exit code | User-visible | Recorded |
|--------|----------------|-------------|----------|
| `block` | non-zero (fails the hook) | yes — error message | yes |
| `warn` | zero (hook passes) | yes — warning message | yes |
| `shadow` | zero (hook passes) | no | yes |
| `info` | zero (hook passes) | yes — info message | yes |

#### Example

```yaml
guardrail_policies:
  default-enforcement:
    description: "Standard enforcement policy for all guardrails"
    rules:
      - guardrail: no-force-push
        severity: critical
        action: block
        allow_override: false

      - guardrail: no-rebase
        severity: critical
        action: block
        allow_override: false

      - guardrail: english-only-code
        severity: warning
        action: warn
        allow_override: true
        override_requires: [rationale]
        escalation:
          target: tech-lead
          condition: "override_count > 3"

      - guardrail: test-before-commit
        severity: mandatory
        action: warn
        allow_override: false

  gradual-rollout:
    description: "Shadow mode for newly introduced guardrails"
    rules:
      - guardrail: english-only-code
        severity: info
        action: shadow
        allow_override: true
```

#### 2.2.1 Conditional Action

Policy rules support state-dependent action via the conditional form:

```yaml
- guardrail: branch-lock
  severity: critical
  action:
    default: block
    when:
      maintenance: shadow
```

**Semantics:**

- `action: "block"` (string) — always applies this action. Backward compatible.
- `action: { default, when }` (object) — applies `default` normally; when the workspace is in a named state (from `system.states`), applies the override from `when`.
- `severity` is NOT state-dependent. The importance of a guardrail does not change by workspace mode.
- At runtime, exactly one action is resolved: the `when` entry matching the current state, or `default` if no match.

**State resolution** is the responsibility of the guardrail runtime (binding scripts), not agent-contracts. The runtime reads the current workspace state (e.g., from a state file managed by the orchestrator) and resolves the effective action.

### 2.3 Updated DslSchema

```typescript
// src/schema/dsl.ts
export const DslSchema = z
  .object({
    version: z.literal(1),
    extends: z.string().optional(),
    system: SystemSchema,
    agents: z.record(z.string(), AgentSchema).default({}),
    tasks: z.record(z.string(), TaskSchema).default({}),
    artifacts: z.record(z.string(), ArtifactSchema).default({}),
    tools: z.record(z.string(), ToolSchema).default({}),
    validations: z.record(z.string(), ValidationSchema).default({}),
    handoff_types: z.record(z.string(), HandoffTypeSchema).default({}),
    team_interface: TeamInterfaceSchema.optional(),
    imports: z.record(z.string(), TeamImportSchema).optional(),
    workflow: z.record(z.string(), WorkflowSchema).default({}),
    policies: z.record(z.string(), PolicySchema).default({}),
    guardrails: z.record(z.string(), GuardrailSchema).default({}),
    guardrail_policies: z
      .record(z.string(), GuardrailPolicySchema)
      .default({}),
    components: ComponentsSchema.default({ schemas: {} }),
    extensions: z
      .record(z.string(), XExtensionDeclSchema)
      .default({}),
    extensions_strict: z.boolean().default(false),
  })
  .passthrough();
```

#### SystemSchema — `system.states`

The `system` section uses `SystemSchema`. The `states` field declares named workspace states referenced by conditional policy actions (`action.when`).

| Field | Required | Description |
|-------|----------|-------------|
| `states` | no | Array of named workspace states (e.g., `["idle", "work", "maintenance"]`). States referenced in `action.when` must be declared here. Defaults to `[]`. |

```yaml
system:
  id: my-project
  name: My Project
  default_workflow_order: [implement]
  states: [idle, work, maintenance]
```

---

## 3. Config Schema Extensions

### 3.1 Updated AgentContractsConfigSchema

```typescript
// src/config/types.ts
export const TeamConfigSchema = z.object({
  dsl: z.string().optional(),
  bindings: z.array(z.string()).default([]),
  vars: z.record(z.string(), z.string()).optional(),
  paths: z.record(z.string(), z.string()).optional(),
  active_guardrail_policy: z.string().optional(),
  interface_output: z.string().optional(),
});

export const AgentContractsConfigSchema = z.object({
  dsl: z.string().optional(),
  vars: z.record(z.string(), z.string()).optional(),
  renders: z.array(RenderTargetSchema).default([]),
  bindings: z.array(z.string()).default([]),
  active_guardrail_policy: z.string().optional(),
  paths: z.record(z.string(), z.string()).optional(),
  teams: z.record(z.string(), TeamConfigSchema).optional(),    // NEW: multi-team
}).superRefine(/* dsl ↔ teams mutual exclusion; each team (except _defaults) must set dsl */);
```

### 3.2 New Fields

| Field | Required | Description |
|-------|----------|-------------|
| `bindings` | no | Array of file paths to software binding YAML files |
| `active_guardrail_policy` | no | Key in DSL `guardrail_policies` to use for generation |
| `paths` | no | Logical root directory mapping for output path resolution |
| `teams` | no | Map of team ID → team config; mutually exclusive with top-level `dsl` |

### 3.3 `paths` — Project Placement Knowledge

Bindings define output targets using logical path variables. Config provides the concrete project-specific values.

```yaml
# agent-contracts.config.yaml
dsl: ./agent-contracts/agent-contracts.yaml

bindings:
  - ./agent-contracts/bindings/cursor.yaml
  - ./agent-contracts/bindings/git.yaml
  - ./agent-contracts/bindings/observability.yaml

active_guardrail_policy: default-enforcement

paths:
  cursor_root: .cursor
  git_hooks_root: scripts/git-hooks
  github_root: .github/workflows
  observability_root: .observ/config

vars:
  project_name: my-project

renders:
  - template: ./agent-contracts/templates/agent-prompt.md.hbs
    context: agent
    output: ./output/{agent.id}.md
```

Bindings reference these via `{path_name}` syntax in their `outputs[].target` fields:

```yaml
# In a binding file
outputs:
  hook-script:
    target: "{cursor_root}/hooks/evaluate-hook.sh"
```

### 3.4 Backward Compatibility

All new fields are optional with safe defaults:

- `bindings` defaults to `[]` (no guardrail generation)
- `active_guardrail_policy` defaults to `undefined` (no policy applied)
- `paths` defaults to `undefined` (binding targets used as-is)

Existing configs without guardrail fields continue to work without modification. The `renders` field defaults to `[]`. When `teams` is present, top-level `dsl` is omitted; each team entry must specify its own `dsl`.

---

## 4. Software Binding Schema

### 4.1 File Location

New module at `src/schema/binding.ts`.

### 4.2 SoftwareBindingSchema

```typescript
// --- Matcher: shared check logic types ---

const CommandRegexMatcherSchema = z.object({
  type: z.literal("command_regex"),
  pattern: z.string(),
});

const ContentRegexMatcherSchema = z.object({
  type: z.literal("content_regex"),
  pattern: z.string(),
  file_glob: z.string().optional(),
  exclude_glob: z.string().optional(),
});

const FileGlobMatcherSchema = z.object({
  type: z.literal("file_glob"),
  pattern: z.string(),
});

const MatcherSchema = z.discriminatedUnion("type", [
  CommandRegexMatcherSchema,
  ContentRegexMatcherSchema,
  FileGlobMatcherSchema,
]);

// --- Check: detection logic only ---
// script: exit 0 = pass, non-0 = detected
// Policy judgment (block/warn/shadow) and reporting are applied
// externally by the template.

const CheckSchema = z.object({
  matcher: MatcherSchema.optional(),
  script: z.string().optional(),
  message: z.string().optional(),
}).passthrough();
// passthrough allows software-specific fields:
//   hook_event, tool_name (Cursor)
//   git_hook (Git)
//   gate, name (GitHub)
//   rule_id, event_code, category (observability engine)

// --- Output: logical output definition ---

const BindingOutputSchema = z.object({
  target: z.string(),
  template: z.string().optional(),
  inline_template: z.string().optional(),
  mode: z.enum(["write", "patch"]).default("write"),
  group_by: z.string().optional(),
  executable: z.boolean().optional(),
}).passthrough().refine(
  (data) => !(data.template && data.inline_template),
  { message: "template and inline_template are mutually exclusive" },
);

// --- Reporting: result recording (observability binding) ---

const ReportingSchema = z.object({
  commands: z.record(z.string(), z.string()),
  fail_open: z.boolean().default(true),
  timeout_ms: z.number().default(5000),
}).passthrough();

// --- Top-level binding ---

const GuardrailImplSchema = z.object({
  checks: z.array(CheckSchema),
});

export const SoftwareBindingSchema = z.object({
  software: z.string(),
  version: z.literal(1),
  extends: z.string().optional(),
  guardrail_impl: z.record(z.string(), GuardrailImplSchema).optional(),
  outputs: z.record(z.string(), BindingOutputSchema).optional(),
  reporting: ReportingSchema.optional(),
}).passthrough();

export type SoftwareBinding = z.infer<typeof SoftwareBindingSchema>;
```

### 4.3 Two Roles of Bindings

| Role | `guardrail_impl` | `reporting` | Examples |
|------|-------------------|-------------|----------|
| **Check-execution** | present (matcher, script) | absent | Cursor, GitHub, Git |
| **Result-recording** | absent (does not evaluate) | present (command patterns) | Observability engine |

Both roles use `outputs` to define their generated artifacts.

### 4.4 Check Implementation Scope

The `script` field in `CheckSchema` contains **pure detection logic only**:

- Exit code 0 = pass (no violation detected)
- Exit code non-0 = detected (violation found)

Scripts do **not** contain policy logic (block/warn/shadow) or reporting (e.g., event emission to an observability engine). The template wraps each script in a subshell, captures the exit code, and applies policy + reporting externally. This separation means the same detection script can be block or warn depending on the active policy.

### 4.5 Template Duality

Bindings support two ways to specify templates:

**Inline template** — embedded in the YAML binding file:

```yaml
outputs:
  hook-script:
    target: "{cursor_root}/hooks/evaluate-hook.sh"
    mode: write
    executable: true
    inline_template: |
      #!/bin/bash
      set -euo pipefail
      INPUT=$(cat /dev/stdin)
      COMMAND=$(echo "$INPUT" | jq -r '.command // empty')
      # ... generated checks ...
```

**External template** — reference to a Handlebars file:

```yaml
outputs:
  workflow:
    target: "{github_root}/guardrails.yml"
    mode: write
    template: ./templates/github-guardrail-job.yml.hbs
```

Resolution priority:

1. If `inline_template` is present, use it
2. If `template` is present, resolve the path and use it
3. If both are present, emit a validation error
4. If neither is present, emit a validation error

**Guidelines**:

- **Inline** is best for: short shell wrappers, small JSON patches, tightly-coupled small artifacts
- **External** is best for: long Handlebars templates, multi-file templates, files that benefit from syntax highlighting / linting / testing, long YAML like GitHub Actions workflows

### 4.6 Binding Examples

#### Cursor Binding

```yaml
software: cursor
version: 1

guardrail_impl:
  no-force-push:
    checks:
      - hook_event: beforeShellExecution
        matcher:
          type: command_regex
          pattern: "git\\s+push\\s+.*--force"
        message: "Force push is forbidden per project guardrails"
      - hook_event: beforeShellExecution
        matcher:
          type: command_regex
          pattern: "git\\s+push\\s+.*-f\\b"
        message: "Force push (-f) is forbidden per project guardrails"

  no-rebase:
    checks:
      - hook_event: beforeShellExecution
        matcher:
          type: command_regex
          pattern: "git\\s+rebase"
        message: "Rebase is prohibited; use merge instead"

  english-only-code:
    checks:
      - hook_event: afterFileEdit
        matcher:
          type: content_regex
          pattern: "[\\u3040-\\u309F\\u30A0-\\u30FF\\u4E00-\\u9FFF]"
          file_glob: "src/**/*.{ts,rs,py}"
          exclude_glob: "*.md"
        message: "Japanese characters detected in source code"

  test-before-commit:
    checks:
      - hook_event: beforeShellExecution
        matcher:
          type: command_regex
          pattern: "git\\s+commit"
        message: "Ensure tests pass before committing (cargo test)"

outputs:
  hooks-json:
    target: "{cursor_root}/hooks.json"
    mode: patch
    template: builtin:cursor/hooks-json-patch

  hook-script:
    target: "{cursor_root}/hooks/evaluate-hook.sh"
    mode: write
    executable: true
    template: ./templates/cursor-hook-wrapper.sh.hbs

  policy-bundle:
    target: "{cursor_root}/guardrails/policy.json"
    mode: write
    inline_template: |
      {{json resolved_checks}}
```

#### Git Binding

```yaml
software: git
version: 1

guardrail_impl:
  no-force-push:
    checks:
      - git_hook: pre-push
        script: |
          #!/bin/bash
          while read local_ref local_sha remote_ref remote_sha; do
            REMOTE_BRANCH=$(echo "$remote_ref" | sed 's|refs/heads/||')
            if [ "$REMOTE_BRANCH" = "main" ] || [ "$REMOTE_BRANCH" = "master" ]; then
              FORCE_PUSH=$(git log --oneline "$remote_sha..$local_sha" 2>/dev/null | wc -l)
              if [ "$FORCE_PUSH" -eq 0 ] && [ "$remote_sha" != "0000000000000000000000000000000000000000" ]; then
                exit 1
              fi
            fi
          done
          exit 0
        message: "Force push to main/master is blocked"

  english-only-code:
    checks:
      - git_hook: pre-commit
        script: |
          #!/bin/bash
          FILES=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(ts|rs|py)$' | grep -v '\.md$' || true)
          for f in $FILES; do
            if grep -P '[\x{3040}-\x{309F}\x{30A0}-\x{30FF}\x{4E00}-\x{9FFF}]' "$f" >/dev/null 2>&1; then
              exit 1
            fi
          done
          exit 0
        message: "Japanese characters in source files"

outputs:
  hook-scripts:
    target: "{git_hooks_root}/"
    mode: write
    group_by: git_hook
    executable: true
    template: builtin:git/hook-script
```

#### Observability Binding

An observability binding connects guardrail execution results to an external observability engine. It does not evaluate guardrails itself — it only defines how to record results and what event schemas to generate.

```yaml
software: observability
version: 1

# The observability binding does not evaluate guardrails — no guardrail_impl

outputs:
  loop-definition:
    target: "{observability_root}/guardrail-loop.yaml"
    mode: write
    template: builtin:observability/loop-definition

  event-schema:
    target: "{observability_root}/guardrail-events.yaml"
    mode: write
    template: builtin:observability/event-schema

# reporting.commands: placeholder command patterns for the observability engine CLI.
# The actual CLI name and flags depend on the specific engine in use.
# Templates expand {{placeholder}} tokens without knowing the engine's CLI format.
reporting:
  commands:
    on_started: >-
      observ emit guardrail.check.started
      --guardrail-id {{guardrail_id}}
      --source {{source}}
    on_matched: >-
      observ emit guardrail.check.matched
      --guardrail-id {{guardrail_id}}
      --action {{action}}
      --severity {{severity}}
      --source {{source}}
    on_recommended: >-
      observ emit guardrail.action.recommended
      --guardrail-id {{guardrail_id}}
      --recommended-action {{recommended_action}}
      --severity {{severity}}
      --source {{source}}
    on_action_taken: >-
      observ emit guardrail.action.taken
      --guardrail-id {{guardrail_id}}
      --action {{action}}
      --source {{source}}
    on_outcome: >-
      observ emit guardrail.outcome
      --guardrail-id {{guardrail_id}}
      --outcome {{outcome}}
      --source {{source}}
      --session-id {{session_id}}
  fail_open: true
  timeout_ms: 5000
```

---

## 5. Target Path Resolution Pipeline

### 5.1 Resolution Order

1. Read `outputs[].target` from the binding (e.g., `"{cursor_root}/hooks/evaluate-hook.sh"`)
2. Expand logical variables from `config.paths` (e.g., `cursor_root` → `.cursor`)
3. Expand remaining `${vars.*}` from `config.vars` (reuses the existing variable substitution pipeline)
4. Resolve relative to the config file directory (same behavior as `config.dsl`)

### 5.2 Variable Syntax

Path variables in binding targets use `{name}` syntax (single braces) to distinguish from the existing `${vars.name}` syntax used in DSL variable substitution.

| Syntax | Source | Example |
|--------|--------|---------|
| `{cursor_root}` | `config.paths` | Binding output targets |
| `${vars.project_name}` | `config.vars` | DSL value substitution |

### 5.3 Default Behavior

If a binding target contains `{name}` but `config.paths` does not define `name`, generation fails with a clear error message indicating which path variable is missing and which binding requires it.

---

## 6. Reference Integrity Checks

### 6.1 Additions to `checkReferences()`

The existing reference checker in `src/validator/reference-resolver.ts` is extended with guardrail-specific checks.

#### New ID Sets

```typescript
const guardrailIds = new Set(Object.keys(dsl.guardrails));
const guardrailPolicyIds = new Set(Object.keys(dsl.guardrail_policies));
```

#### New Checks

**Guardrail scope references** — each `guardrails[].scope` field references existing entities:

```
guardrails.{id}.scope.agents[]    → agents
guardrails.{id}.scope.tasks[]     → tasks
guardrails.{id}.scope.tools[]     → tools
guardrails.{id}.scope.artifacts[] → artifacts
guardrails.{id}.scope.workflows[] → system.default_workflow_order
```

**Guardrail policy rule references** — each rule references a guardrail:

```
guardrail_policies.{id}.rules[].guardrail → guardrails
```

**Config active policy reference** — `active_guardrail_policy` references a policy:

```
config.active_guardrail_policy → guardrail_policies
```

### 6.2 Binding Cross-Reference Checks

These run when bindings are loaded (requires both DSL and binding data):

**Binding guardrail_impl keys** — each key must exist in DSL guardrails:

```
binding.guardrail_impl.{key} → guardrails
```

**Error codes**:

| Code | Level | Description |
|------|-------|-------------|
| `guardrail-scope-ref-not-found` | error | Guardrail scope references a non-existent entity |
| `guardrail-policy-ref-not-found` | error | Policy rule references a non-existent guardrail |
| `binding-guardrail-not-found` | error | Binding implements a guardrail not defined in DSL |
| `active-policy-not-found` | error | Config references a non-existent guardrail policy |

---

## 7. Lint Rules

### 7.1 New Rules

| Rule ID | Level | Condition |
|---------|-------|-----------|
| `guardrail-no-binding` | warning | A guardrail is defined in DSL but has no `guardrail_impl` in any loaded binding |
| `guardrail-no-policy-rule` | warning | A guardrail is defined in DSL but is not referenced by any rule in the `active_guardrail_policy` |
| `binding-guardrail-undefined` | error | A binding `guardrail_impl` key does not match any guardrail in the DSL |
| `policy-guardrail-undefined` | error | A policy rule references a guardrail that does not exist in the DSL |
| `binding-template-conflict` | error | A binding output specifies both `template` and `inline_template` |
| `binding-template-missing` | error | A binding output specifies neither `template` nor `inline_template` |
| `binding-path-unresolved` | error | A binding target uses `{name}` but config has no matching `paths` entry |
| `validation-executor-no-context` | warning | A validation executor (agent/tool) exists in the DSL but the validation is not listed in the executor's prompt context |
| `guardrail-policy-action-state-undefined` | error | A state key in `action.when` is not listed in `system.states` |
| `system-states-unused` | info | A state in `system.states` is not referenced by any `action.when` in any policy |

### 7.2 Existing Rule Interactions

- `guardrails` and `guardrail_policies` are subject to existing Spectral lint rules (kebab-case IDs, etc.)
- The existing `check` command automatically picks up schema validation for the new sections
- `extends` merge behavior applies to `guardrails` and `guardrail_policies` the same as other top-level maps

---

## 8. CLI Commands

### 8.1 New Command: `generate guardrails`

```bash
agent-contracts generate guardrails -c agent-contracts.config.yaml
agent-contracts generate guardrails -c agent-contracts.config.yaml --binding cursor
agent-contracts generate guardrails -c agent-contracts.config.yaml --binding cursor --binding git
```

**Options**:

| Flag | Description |
|------|-------------|
| `-c, --config <path>` | Path to config file (required) |
| `--binding <name>` | Filter to specific software binding(s); repeatable |
| `--dry-run` | Print what would be generated without writing files |

**Processing pipeline**:

1. Load config
2. Load and resolve DSL (existing pipeline)
3. Select `active_guardrail_policy` from DSL `guardrail_policies`
4. Load each binding file from `config.bindings`:
   a. Parse YAML
   b. Resolve `extends` chain recursively (see section 10.2)
   c. Merge base and project bindings
   d. Validate merged result against `SoftwareBindingSchema`
5. Run cross-reference checks (binding keys → DSL guardrails, policy → guardrails)
6. For each binding with `outputs`:
   a. Resolve the `BindingGenerationContext` (see section 9)
   b. For each output entry, resolve the target path (section 5)
   c. Render using inline or external template
   d. Write output (mode: `write` replaces, `patch` merges)

### 8.2 Existing Command Updates

| Command | Change |
|---------|--------|
| `validate` | Validates `guardrails` and `guardrail_policies` schemas automatically (via updated `DslSchema`) |
| `lint` | Runs new lint rules (section 7) when bindings are available |
| `check` | Includes guardrail reference checks in the combined diagnostics |
| `resolve` | Resolved output includes `guardrails` and `guardrail_policies` |

### 8.3 Context Types Update

`CONTEXT_TYPES` in `src/config/types.ts` is extended:

```typescript
export const CONTEXT_TYPES = [
  "agent",
  "task",
  "artifact",
  "tool",
  "validation",
  "handoff_type",
  "workflow",
  "policy",
  "guardrail",          // NEW
  "guardrail_policy",   // NEW
  "system",
] as const;
```

This enables `context: guardrail` and `context: guardrail_policy` in render targets, allowing guardrail-specific prompt templates.

---

## 9. Generation Context

### 9.1 BindingGenerationContext

Passed to each binding's `outputs` and `renders` templates during `generate guardrails`:

```typescript
interface ResolvedCheck {
  guardrail_id: string;
  guardrail: Guardrail;
  policy_rule: GuardrailPolicyRule;
  check: Check;   // CheckSchema instance with passthrough fields
}

interface BindingGenerationContext {
  system: { id: string; name: string };
  guardrails: Record<string, Guardrail>;
  policy: GuardrailPolicy;
  binding: SoftwareBinding;
  all_bindings: Record<string, SoftwareBinding>;
  vars: Record<string, string>;
  paths: Record<string, string>;
  reporting: {
    commands: Record<string, string>;
    fail_open: boolean;
    timeout_ms: number;
  } | null;
  resolved_checks: ResolvedCheck[];

  // DSL entity maps
  tasks: Record<string, Task>;
  artifacts: Record<string, Artifact>;
  agents: Record<string, Agent>;
  handoff_types: Record<string, HandoffType>;
  workflow: Record<string, Workflow>;
}
```

### 9.2 `resolved_checks` Construction

For each binding, `resolved_checks` is built by joining three sources:

1. **Binding** `guardrail_impl[guardrail_id].checks[]` — the check definitions
2. **DSL** `guardrails[guardrail_id]` — the guardrail metadata
3. **Policy** `active_policy.rules.find(r => r.guardrail === guardrail_id)` — the enforcement rule

Each check in a binding's `guardrail_impl` becomes one `ResolvedCheck` entry. If a guardrail has no policy rule, it is excluded from `resolved_checks` (shadow-mode: no enforcement).

### 9.3 `reporting` Construction

The `reporting` field is populated from the observability binding's `reporting` section (if a binding with `reporting` is loaded). If no such binding is present, `reporting` is `null`, and templates skip emit commands.

### 9.4 Template Helpers

Templates have access to the following Handlebars helpers:

| Helper | Description |
|--------|-------------|
| `{{json value}}` | Serialize value as JSON |
| `{{eq a b}}` | Equality comparison |
| `{{expand pattern key=value ...}}` | Expand `{{placeholder}}` patterns in reporting commands |

The `expand` helper resolves `{{placeholder}}` tokens within `reporting.commands` strings, substituting keyword arguments. This decouples templates from the observability engine's CLI parameter format.

---

## 10. `extends` Behavior

### 10.1 DSL Inheritance

`guardrails` and `guardrail_policies` follow the same merge semantics as other top-level DSL maps:

- Base entries are inherited
- Child entries with the same key override the base
- Merge operators (`$append`, etc.) work as expected
- `.passthrough()` ensures extension fields survive the merge

```yaml
# base/agent-contracts.yaml
guardrails:
  no-force-push:
    description: "Force push is forbidden"
    scope:
      tools: [git]

guardrail_policies:
  org-standard:
    rules:
      - guardrail: no-force-push
        severity: critical
        action: block
```

```yaml
# project/agent-contracts.yaml
extends: "@my-org/agent-contracts-base"

guardrails:
  english-only-code:
    description: "Source code must not contain Japanese characters"
    scope:
      artifacts: [source-code]
```

The resolved DSL contains both `no-force-push` (from base) and `english-only-code` (from project).

### 10.2 Binding Inheritance

Binding files support their own `extends` field, mirroring the DSL-level `extends` mechanism. This allows organizations to define shared base bindings (e.g., common guardrail implementations for Cursor or Git) and let individual projects extend them with project-specific additions or overrides.

**Status**: Implemented in v0.11.x (`src/config/binding-loader.ts`, `src/config/binding-merger.ts`).

#### 10.2.1 Resolution Pipeline

When `loadBindings` encounters a binding file with an `extends` field, it resolves the base before schema validation:

1. Parse the binding YAML into a raw object
2. If `extends` is present:
   a. Resolve the base path (local or npm package — see §10.2.3)
   b. Load the base binding YAML recursively (the base may itself have `extends`)
   c. Merge base and project using `mergeBinding()` (see §10.2.2)
3. Validate the merged result against `SoftwareBindingSchema`

The `extends` field is stripped from the merged result, just like DSL `extends`.

#### 10.2.2 Merge Semantics

The `mergeBinding(base, project)` function applies field-specific merge strategies:

| Field | Merge Behavior |
|-------|---------------|
| `software` | Project wins (scalar override) |
| `version` | Project wins (scalar override) |
| `guardrail_impl` | **Map merge** by guardrail ID. New IDs from the project are added. Same IDs are deep-merged (project fields override base fields within each guardrail entry). Merge operators (`$append`, `$prepend`, `$insert_after`, `$replace`, `$remove`) are supported on `checks` arrays when `extends` is present. |
| `outputs` | **Map merge** by output ID. New output IDs from the project are added. Same IDs are deep-merged (project fields override base fields). |
| `reporting` | **Deep merge**. Project fields override base fields recursively. If only the base has `reporting`, it is inherited as-is. |
| passthrough fields (`x-*`, etc.) | Project wins for same keys; base keys not in the project are preserved. |
| `extends` | Stripped from the final merged result. |

The merge implementation reuses `mergeEntityMaps` and `deepMergeEntities` from the DSL merger (`src/resolver/merger.ts`), ensuring consistent operator behavior.

**Example — disjoint guardrail_impl (typical project extension):**

```yaml
# base/bindings/cursor.yaml
software: cursor
version: 1
guardrail_impl:
  no-force-push:
    checks:
      - hook_event: beforeShellExecution
        matcher: { type: command_regex, pattern: "git\\s+push\\s+.*--force" }
        message: "Force push is forbidden"
  no-rebase:
    checks:
      - hook_event: beforeShellExecution
        matcher: { type: command_regex, pattern: "git\\s+rebase" }
        message: "Rebase is prohibited"
outputs:
  policy-bundle:
    target: "{cursor_root}/guardrails/policy.json"
    mode: write
    inline_template: "{{json resolved_checks}}"
```

```yaml
# project/bindings/cursor.yaml
extends: ../../base/bindings/cursor.yaml
software: cursor
version: 1
guardrail_impl:
  lint-on-save:
    checks:
      - hook_event: afterFileEdit
        matcher: { type: file_glob, pattern: "**/*.{ts,tsx}" }
        message: "TS file edited — lint results attached."
  lineage-impact-check:
    checks:
      - hook_event: afterFileEdit
        matcher: { type: file_glob, pattern: "{server/**,frontend/**}/*.ts" }
        message: "Lineage-scoped file changed."
```

Merged result: `guardrail_impl` contains all four entries (`no-force-push`, `no-rebase`, `lint-on-save`, `lineage-impact-check`). The `outputs.policy-bundle` is inherited from the base, producing a single `policy.json` with checks from all four guardrails.

**Example — $append operator on checks array:**

```yaml
# project/bindings/cursor.yaml
extends: ../../base/bindings/cursor.yaml
software: cursor
version: 1
guardrail_impl:
  no-force-push:
    checks:
      $append:
        - hook_event: beforeShellExecution
          matcher: { type: command_regex, pattern: "git\\s+push\\s+.*-f\\b" }
          message: "Force push (-f shorthand) is forbidden"
```

Merged result: `no-force-push.checks` contains both the base check (`--force`) and the appended check (`-f`).

**Example — output override:**

```yaml
# project/bindings/cursor.yaml
extends: ../../base/bindings/cursor.yaml
software: cursor
version: 1
outputs:
  policy-bundle:
    target: "{cursor_root}/guardrails/policy.json"
    mode: write
    template: ./templates/custom-policy.json.hbs
```

Merged result: `policy-bundle.template` is overridden to use a project-specific template, while the `target` is preserved from the project definition.

#### 10.2.3 Base Path Resolution

The `extends` value is resolved using the same strategies as DSL `extends`:

| Pattern | Resolution |
|---------|-----------|
| `./path` or `../path` | Relative to the binding file's directory |
| `@scope/package` or `package-name` | npm package resolution via `import.meta.resolve` |

**Local path resolution:**

- If the path resolves to a **file**, that file is loaded directly.
- If the path resolves to a **directory**, the loader looks for `binding.yaml` or `binding.yml` within it (in that order). If neither exists, an error is thrown.

**npm package resolution:**

```yaml
extends: "@my-org/agent-contracts-base-bindings"
```

The loader uses `import.meta.resolve` to find the package, then looks for a `binding.yaml` entry file in the resolved directory.

#### 10.2.4 Chained Inheritance

Binding `extends` supports arbitrary chain depth. Each base is resolved recursively before merging:

```
grandparent.yaml → parent.yaml → child.yaml
```

The merge applies bottom-up: grandparent is merged with parent first, then the result is merged with child. This follows the same precedence as DSL `extends` chains.

#### 10.2.5 Circular Detection

The binding loader tracks all visited file paths during recursive resolution. If a path is encountered a second time, the loader throws a `ConfigLoadError` with a clear message:

```
Circular binding extends detected: /path/to/binding.yaml
```

#### 10.2.6 Config Impact

When using binding `extends`, the config's `bindings` array should list only the **leaf** (child) binding files. Base bindings referenced via `extends` are loaded automatically and should not appear separately in the config:

```yaml
# agent-contracts.config.yaml
bindings:
  - ./bindings/cursor.yaml         # extends base internally
  - ./bindings/git.yaml
  - ./bindings/observability.yaml
```

If both a base and its child are listed in the config, they are treated as independent bindings — the base is loaded twice (once standalone, once as extends target). This is valid but typically not desired.

---

## 11. Generated Output Examples

### 11.1 Git Hook Script (pre-commit)

When `group_by: git_hook` is set, the template collects all checks for each `git_hook` value and generates one file per hook. Example output for `scripts/git-hooks/pre-commit`:

```bash
#!/bin/bash
# Auto-generated by agent-contracts. Do not edit manually.
set -uo pipefail

FINAL_EXIT=0

# --- english-only-code (warning) ---
CHECK_RESULT=0
(
#!/bin/bash
FILES=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(ts|rs|py)$' | grep -v '\.md$' || true)
for f in $FILES; do
  if grep -P '[\x{3040}-\x{309F}\x{30A0}-\x{30FF}\x{4E00}-\x{9FFF}]' "$f" >/dev/null 2>&1; then
    exit 1
  fi
done
exit 0
) || CHECK_RESULT=$?

if [ "$CHECK_RESULT" -ne 0 ]; then
  echo "WARNING: Japanese characters in source files"
fi

exit $FINAL_EXIT
```

Key patterns:

- Each script runs in a **subshell** `( ... ) || CHECK_RESULT=$?` so its `exit` does not terminate the parent
- `block` actions set `FINAL_EXIT=1`; `warn` / `shadow` / `info` do not
- If `reporting` is available, observability engine emit commands are inserted at detection points
- All checks run regardless of earlier failures, allowing full diagnostic output

### 11.2 Cursor hooks.json (patch mode)

In `patch` mode, the generator reads the existing `hooks.json`, adds entries to the appropriate hook event arrays, and writes back. Existing entries not managed by agent-contracts are preserved.

---

## 12. JSON Schema Updates

The `scripts/generate-json-schema.ts` script generates `schemas/dsl.schema.json` from the Zod `DslSchema`. Since `guardrails` and `guardrail_policies` are added to `DslSchema`, they are automatically included in the generated JSON Schema.

Additionally, a new schema file `schemas/binding.schema.json` should be generated from `SoftwareBindingSchema` to enable IDE validation for binding YAML files.

---

## 13. Implementation Priority

| Order | Item | Estimated Effort | Status |
|-------|------|-----------------|--------|
| 1 | DSL `guardrails:` schema + validate/lint | 1 week | ✅ Done |
| 2 | DSL `guardrail_policies:` schema + guardrail ID reference checks | 3 days | ✅ Done |
| 3 | Config `bindings:` + `active_guardrail_policy:` + `paths:` + binding loader | 1 week | ✅ Done |
| 4 | Binding validation + DSL↔binding cross-reference checks | 3 days | ✅ Done |
| 5 | `generate guardrails` command: Cursor minimal implementation (path resolution + inline_template) | 1–2 weeks | ✅ Done |
| 5a | Binding `extends` inheritance (§10.2) | 2 days | ✅ Done (v0.2.0) |
| 6 | Observability binding: reporting definition + event schema output | 3 days | Planned |
| 7 | GitHub / Git binding support | 1 week each | Planned |

### 13.1 Vertical Slice Strategy

Rather than implementing all features horizontally, the recommended approach is a **vertical slice**: implement one guardrail (`no-force-push`) end-to-end across all layers:

1. Define in DSL `guardrails:`
2. Add policy rule in `guardrail_policies:`
3. Implement in a Cursor binding
4. Add to config with `bindings:` and `paths:`
5. Generate the Cursor hook output
6. Verify the generated output works

This validates the entire pipeline before broadening to more guardrails and bindings.

---

## 14. Design Decisions Summary

| Decision | Rationale |
|----------|-----------|
| Binding = software knowledge, Config = project placement | Bindings are reusable across projects; project-specific paths belong in config |
| `guardrail_policies:` as a new section (not extending `policies:`) | Existing `policies:` handles validation requirements with a different schema (`when` + `requires_validations`). Guardrail enforcement is a separate concern |
| `scope` contains only DSL entity references | Command strings, regex patterns, and file globs are implementation details belonging in bindings |
| Software-based binding separation (not environment-based) | Cursor→Claude Code migration requires only Cursor binding replacement; GitHub/observability bindings remain unchanged |
| Unified `SoftwareBindingSchema` for check-execution and result-recording | `guardrail_impl` and `reporting` are both optional, accommodating both roles in one schema |
| `script` is pure detection logic | Policy judgment and reporting are applied by templates, enabling the same script to be block or warn depending on policy |
| `inline_template` and `template` dual support | Short scripts benefit from inline co-location; long templates benefit from external file tooling |
| `{path_var}` in targets, resolved from `config.paths` | Decouples binding portability from project directory structure |
| Observability binding has no `guardrail_impl` | The observability engine never evaluates guardrails; it only defines recording commands and event schemas |
| `reporting.commands` uses placeholder patterns | Templates expand placeholders without knowing the observability engine's CLI parameter format; recording backend is swappable |
| Hook-event-level file generation with subshell script execution | One pre-commit file contains all guardrails; script exit codes don't affect other checks; block accumulation determines final exit |
| Binding `extends` mirrors DSL `extends` semantics | Reuses the same merge operators and resolution strategies; organizations define shared base bindings, projects extend with additions; config lists only leaf bindings |
| `mergeBinding` reuses DSL merger primitives (`mergeEntityMaps`, `deepMergeEntities`) | Consistent merge behavior across DSL and bindings; single source of truth for operator semantics; reduces implementation surface |
