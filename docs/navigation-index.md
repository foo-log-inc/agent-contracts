# Navigation Index

**Version**: 0.35.0
**Date**: 2026-05-20

---

## 1. Overview

The **navigation index** is a compile-time, queryable model that maps each DSL artifact to its operations, agent permissions, inter-artifact relations, and recommended action routes. It answers the question: *who can do what to which artifact, and what should happen when an artifact changes?*

The index is built from the resolved agent-contracts DSL — artifacts, agents, and tools — without executing workflows or invoking CLIs. It is intended for runtime planners, guardrail generators, governance tools, and agent orchestration layers that need structured artifact-centric navigation data.

### 1.1 Relationship to Other Commands

| Command | Output | Purpose |
|---------|--------|---------|
| `generate` | Runtime files (hooks, rules, prompts, guardrail bindings) | Renders Handlebars templates and binding outputs into the project tree |
| `navigation-index` | Structured model (`ProjectNavigationIndex`) | Produces a queryable artifact-centric index for downstream consumers |

`generate` writes files; `navigation-index` writes a data model. Both consume the same resolved DSL, but they serve different consumers. The navigation index can be consumed directly by external tools that read JSON or YAML from stdout, or used as context for binding renders during `generate templates`.

### 1.2 Architecture

```text
agent-contracts.yaml (DSL)
  artifacts, agents, tools (with extends + artifact_bindings)
        │
        ▼
  agent-contracts navigation-index
        │
        ▼
  ProjectNavigationIndex (JSON/YAML on stdout)
        │
        ├─ runtime planners / governance tools (direct consumption)
        │
        └─ binding renders (context: navigation-index)
              └─ artifact protection rules, routing hooks, agent context files
```

The navigation index command and the `navigation-index` binding render context type were introduced in **agent-contracts 0.35.0**.

---

## 2. CLI Usage

### 2.1 Basic Invocation

```text
agent-contracts navigation-index
agent-contracts navigation-index path/to/agent-contracts.yaml
agent-contracts navigation-index -c agent-contracts.config.yaml
agent-contracts navigation-index --format yaml
agent-contracts navigation-index --artifact api-contracts
```

The command resolves the DSL (including extends merge and variable substitution from config), validates against the schema, builds the navigation index, and writes the result to stdout.

### 2.2 Options

| Option | Aliases | Default | Description |
|--------|---------|---------|-------------|
| `--format` | | `json` | Output format: `json` or `yaml` |
| `--artifact` | | | Filter output to a single artifact by ID; top-level index fields are preserved, but `artifacts` contains only the matching node |
| `--config` | `-c` | | Path to `agent-contracts.config.yaml` for DSL path, vars, and multi-team config |
| `--team` | | | Limit to one team when using multi-team config |
| `--quiet` | | `false` | Suppress informational output (team section headers in YAML multi-team mode) |

| Argument | Required | Description |
|----------|----------|-------------|
| `dir` | No | Path to `agent-contracts.yaml`; defaults via config or current directory |

**Exit 0:** Navigation index built successfully; result on stdout.

**Exit 1:** Resolution failure, schema validation failure, unknown artifact ID (with `--artifact`), or invalid `--format`.

### 2.3 Output Structure Overview

The top-level object is a `ProjectNavigationIndex`:

| Field | Description |
|-------|-------------|
| `version` | Index schema version (currently `"1.0.0"`) |
| `generated_at` | ISO 8601 timestamp of index generation |
| `system` | System identity from the DSL (`id`, `name`) |
| `artifacts` | Map of artifact ID → compiled artifact node |

Each artifact node aggregates file patterns, properties, relations, classified operations, agent permissions, and inferred routes for that artifact.

### 2.4 Multi-Team Support

When `agent-contracts.config.yaml` defines a `teams` map, the command processes each selected team independently.

| `--format` | Multi-team output shape |
|------------|-------------------------|
| `json` | Single JSON object keyed by team ID; each value is a full `ProjectNavigationIndex` |
| `yaml` | Sequential YAML documents per team, prefixed with `--- Team: {teamId} ---` unless `--quiet` |

Use `--team` to restrict processing to one team. Schema validation failures for individual teams are reported to stderr; the command exits 1 if any team fails.

---

## 3. Output Schema

This section describes the semantic meaning of each type in the navigation index output.

### 3.1 ProjectNavigationIndex

The root document produced by the CLI.

| Field | Description |
|-------|-------------|
| `version` | Index format version for consumers that may evolve alongside the builder |
| `generated_at` | Point-in-time stamp; the index is not persisted by the command itself |
| `system` | Identifies the project/system from `dsl.system` |
| `artifacts` | Complete map of all DSL artifact IDs to their compiled nodes |

### 3.2 CompiledArtifactNode

One entry per artifact in the DSL. This is the primary unit of navigation.

| Field | Description |
|-------|-------------|
| `id` | Artifact ID (same as the map key) |
| `files` | File location metadata for path-based lookup |
| `properties` | Authority and edit-policy metadata from the artifact definition |
| `relations` | Upstream and downstream artifact links derived from tool read/write graph |
| `operations` | Tools classified as producers, validators, or consumers for this artifact |
| `agents` | Agent IDs grouped by permission level |
| `routes` | Recommended action sequences inferred from artifact metadata and operations |

#### files

| Field | Description |
|-------|-------------|
| `path_patterns` | Glob patterns indicating which files belong to this artifact (from `artifacts[].path_patterns`) |
| `exclude_patterns` | Glob patterns excluded from the artifact (from `artifacts[].exclude_patterns`) |

#### properties

| Field | Description |
|-------|-------------|
| `type` | Artifact type string from the DSL |
| `authority` | Provenance class: `canonical`, `derived`, `generated`, or `control` |
| `manual_edit` | Whether direct human editing is permitted: `allowed`, `discouraged`, or `forbidden` |
| `change_control` | Change governance level: `none`, `approval-required`, or `regeneration-required` |

**Default values** (applied when the artifact definition omits the field):

| Field | Default | Meaning |
|-------|---------|---------|
| `authority` | `"canonical"` | Treat as a source-of-truth artifact unless explicitly marked otherwise |
| `manual_edit` | `"allowed"` | No edit restriction unless explicitly set |
| `change_control` | `"none"` | No special change-control workflow unless explicitly set |

#### relations

| Field | Description |
|-------|-------------|
| `source_artifacts` | Upstream artifacts that feed into this one (populated for `generated` and `derived` authority via tool write/read pairing) |
| `derived_artifacts` | Downstream artifacts produced from or consuming this one as input |

#### operations

Operations are grouped by role:

| Group | Meaning |
|-------|---------|
| `producers` | Tools that write or produce this artifact |
| `validators` | Tools that read this artifact for lint, check, test, or audit purposes |
| `consumers` | Tools that read this artifact without qualifying as validators |

#### agents

| Field | Source in DSL |
|-------|---------------|
| `owners` | Agents listing this artifact in `own_artifacts` |
| `editors` | Agents listing this artifact in `can_write_artifacts` |
| `readers` | Agents listing this artifact in `can_read_artifacts` |

#### routes

Optional route arrays keyed by purpose. Routes are automatically inferred from artifact authority, operations, and relations.

| Key | When present |
|-----|--------------|
| `validate` | One or more validator operations exist for the artifact |
| `regenerate` | Artifact has `authority: generated`, at least one producer, and non-empty `source_artifacts` |
| `update` | Artifact has `authority: canonical` |

### 3.3 ArtifactOperation

Represents one tool's involvement with an artifact.

| Field | Description |
|-------|-------------|
| `tool` | Tool ID from the DSL |
| `cli_contract` | cli-contract package name when the tool uses the new model; empty string for legacy tools |
| `command` | Command name (from `tool.command` or `commands[].command`) |
| `slot` | cli-contract artifact slot name when using `artifact_bindings`; empty for legacy read/write links |
| `invokable_by` | Agent IDs allowed to invoke this tool (from `tool.invokable_by`) |

Operations are deduplicated by `tool:command:slot` key.

### 3.4 ArtifactRoute and ArtifactRouteStep

An `ArtifactRoute` is a recommended sequence of actions for a given purpose.

| Field | Description |
|-------|-------------|
| `purpose` | `"update"`, `"regenerate"`, or `"validate"` |
| `steps` | Ordered list of action steps |

Each step is one of three types:

| Step type | Fields | Meaning |
|-----------|--------|---------|
| `edit_artifact` | `artifact`, `candidate_agents` | Edit a source or canonical artifact; agents drawn from editors of that artifact |
| `run_operation` | `operation`, `candidate_agents` | Run a tool; `operation` is the tool ID; agents from `invokable_by` |
| `request_review` | `artifact`, `candidate_agents` | Request review of an artifact (reserved for future route expansion) |

---

## 4. Tool Extends

Tool `extends` (introduced in **agent-contracts 0.35.0**) lets you define shared tool metadata once and inherit it across related tool definitions. Each tool ID represents one concrete usage pattern — one command against a specific set of artifact bindings — rather than one CLI package with many commands.

### 4.1 How extends Works

A **config base tool** declares shared fields: `cli_contract`, `artifact_bindings`, and optionally `kind`, `invokable_by`, and other inherited metadata. Child tools set `extends: <base-tool-id>` and override only what differs — typically `command` and command-specific binding overrides.

When the navigation index is built:

1. Each tool's `extends` chain is resolved so inherited fields are merged into the child; child values take precedence.
2. `artifact_bindings` from base and child are merged, with child keys overriding base keys.
3. Circular `extends` chains are rejected with a clear error.

After resolution, each tool is treated as a flat record with fully merged bindings for index construction.

### 4.2 command Field (New Model)

In the new model, a tool declares a single `command` string (e.g., `lint`, `pipeline`) alongside `cli_contract` and `artifact_bindings`. This replaces the pattern of listing multiple entries under a legacy `commands` array on one tool ID.

Each usage pattern becomes its own tool ID (e.g., `speckeeper-lint`, `micro-contracts-pipeline`), typically extending a shared base.

### 4.3 Backward Compatibility

| Scenario | Behavior |
|----------|----------|
| Tool without `extends` | Unchanged; processed as-is |
| Legacy `commands[]` with `reads`/`writes` | Still supported; links extracted per command entry |
| New model: `cli_contract` + `artifact_bindings` + `command` | Links extracted from bindings; direction resolved from cli-contract `artifactSlots` and command `effects` when available (see Section 6.1) |
| Mixed project | Both models coexist; each tool is handled according to which fields are present |

---

## 5. Binding Renders with `navigation-index` Context

The `navigation-index` context type is available for binding renders defined in `agent-contracts.config.yaml` and binding YAML files. Templates receive the full `ProjectNavigationIndex` as context and produce artifact-aware outputs (protection rules, routing tables) without duplicating artifact metadata in binding check definitions.

### 5.1 Architecture

Binding renders support iterable contexts such as `agent` (one output file per entity) and non-iterable contexts such as `system` (one output file from the full DSL). The `navigation-index` context is **non-iterable** (like `system`):

```text
agent-contracts.config.yaml
  renders:
    - template: artifact-protection.md.hbs
      context: navigation-index
      output: .cursor/rules/artifact-protection.mdc

agent-contracts generate templates
        │
        ▼
Handlebars template receives ProjectNavigationIndex as root context
        │
        ▼
Single output file (not per-artifact iteration)
```

Templates access the full index: all artifacts, operations, agents, and routes are available for filtering and formatting in one pass.

### 5.2 Artifact Protection Rules

Binding renders with `context: navigation-index` can generate rules that block direct edits to protected files and redirect agents to the correct workflow.

| Index field | Use |
|-------------|-----|
| `properties.manual_edit === "forbidden"` | Identify artifacts that must not be edited in place |
| `properties.authority === "generated"` | Identify generated outputs that require regeneration |
| `files.path_patterns` | Map file paths to artifact IDs for hook and rule matchers |
| `routes.regenerate` | Provide step-by-step guidance: edit source artifacts, then run producer tools |
| `agents.editors` on source artifacts | Identify which agents may edit upstream sources |

The render template filters the artifacts map and emits protection rules (Cursor rules, hook scripts, or similar) without re-declaring path patterns or authority in binding `guardrail_impl` check definitions.

### 5.3 Artifact Routing Context

The same context type supports routing tables for architect agents that delegate work based on artifact ownership.

| Index field | Use |
|-------------|-----|
| `agents.owners` | Primary responsible agent per artifact |
| `agents.editors` | Agents permitted to modify the artifact |
| `routes.update` | Canonical artifact change flow: edit, then run validators |
| `routes.regenerate` | Generated artifact update flow: edit sources, run producers |
| `operations.validators` | Tools to run after changes for validation |

Output targets may include architect prompt supplements, routing hook scripts, or team interface files that map file paths and artifact IDs to delegation targets.

### 5.4 Guardrail Responsibility Separation

Guardrail enforcement spans two layers. Splitting responsibilities avoids duplicating artifact metadata:

| Layer | Responsibility | Mechanism |
|-------|----------------|-----------|
| Tool-specific bindings | Lint, drift, and quality checks for specific CLIs | Binding `guardrail_impl` entries (e.g., micro-contracts, speckeeper bindings) |
| Artifact edit protection | Block forbidden edits; route to correct workflow | Binding renders with `context: navigation-index` |

Tool bindings encode *how* to run checks (command patterns, matchers, scripts). The navigation index encodes *what* artifacts exist, who may edit them, and which routes apply — derived from DSL artifact and tool definitions. Binding renders consume the index rather than repeating `path_patterns`, `authority`, or `manual_edit` in each binding file.

---

## 6. Limitations

### 6.1 cli_contract Read/Write Classification

When a tool uses `cli_contract` + `artifact_bindings`, the builder loads the referenced cli-contract YAML file at compile time. If the file declares `artifactSlots` and the tool's command declares `effects` with slot name references (`reads` / `writes` as string arrays), read/write direction is resolved from those declarations — command-level effects take precedence, with `artifactSlots` direction as fallback for slots not listed in the command's effects. Slots declared as `readwrite` in `artifactSlots` are treated as **write** for navigation-index classification.

If the cli-contract file is unavailable or does not declare `artifactSlots`, all bindings default to **read** (the previous behavior). Legacy `commands[].writes` on tools without `cli_contract` remains fully supported.

### 6.2 Route Inference Scope

Route inference is rule-based, not semantic. It models straightforward patterns:

- Canonical artifact → edit + validate
- Generated artifact → edit sources + run producer

Complex multi-step workflows (approval gates, parallel validation chains, conditional branches) beyond source → produce → validate are not modeled. Consumers requiring richer workflows should extend routes externally or wait for future schema extensions.

### 6.3 Non-Goals

The navigation index does not execute workflows, launch agents, run CLIs, record state, or fire triggers. Those remain the responsibility of governance layers and agent runtimes.
