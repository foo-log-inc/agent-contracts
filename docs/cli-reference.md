# agent-contracts CLI

Declarative YAML DSL toolkit for defining, validating, and rendering multi-agent development workflows. Provides static validation, semantic linting, prompt rendering, guardrail generation, and completeness scoring for agent contract definitions.

**Version:** 0.19.1

## Table of Contents

- [agent-contracts](#agent-contracts)
  - [resolve](#agent-contracts-resolve)
  - [validate](#agent-contracts-validate)
  - [lint](#agent-contracts-lint)
  - [render](#agent-contracts-render)
  - [check](#agent-contracts-check)
  - [score](#agent-contracts-score)
  - [audit](#agent-contracts-audit)
  - [generate](#agent-contracts-generate)

---

## agent-contracts

Agent contracts tooling — validate, lint, render DSL files.

### Global Options

| Option | Aliases | Required | Default | Description |
|---|---|---|---|---|
| `--version` | -V | No |  | Print version and exit. |
| `--help` | -h | No |  | Show help and exit. |

### resolve

Resolve DSL (load + merge extends) and output YAML.

Loads the agent-contracts DSL file, merges all extends inheritance chains, substitutes variables from config, and outputs the fully resolved result as YAML or JSON.

**Usage:**

```
agent-contracts resolve
```
```
agent-contracts resolve path/to/agent-contracts.yaml
```
```
agent-contracts resolve --format json
```
```
agent-contracts resolve --expand-defaults
```
```
agent-contracts resolve -c agent-contracts.config.yaml
```

#### Arguments

| Name | Required | Description |
|---|---|---|
| `dir` | No | Path to agent-contracts.yaml. |

#### Options

| Option | Aliases | Required | Default | Description |
|---|---|---|---|---|
| `--config` | -c | No |  | Path to agent-contracts.config.yaml. |
| `--team` |  | No |  | Limit to one team (multi-team config only). |
| `--format` |  | No | `"text"` | Output format. |
| `--expand-defaults` |  | No | `false` | Expand all Zod default values in output. Fields like required_validations, tags, and can_read_artifacts are written explicitly instead of relying on schema defaults. |

#### Exit Codes

**Exit 0:** Resolved DSL output successfully.

- **stdout:** format=`text`

**Exit 1:** Resolution failed (file not found, parse error, or config error).

- **stderr:** format=`text`

#### Extensions

```yaml
x-agent: 
  riskLevel: low
  requiresConfirmation: false
  idempotent: true
  sideEffects: 

```

---

### validate

Validate DSL against schema and check references.

Validates the resolved DSL against the Zod schema, checks inter-entity references (agent→task, task→artifact, etc.), and validates handoff schemas. Reports diagnostics with severity levels.

**Usage:**

```
agent-contracts validate
```
```
agent-contracts validate path/to/agent-contracts.yaml
```
```
agent-contracts validate --strict
```
```
agent-contracts validate --format json
```
```
agent-contracts validate --quiet
```

#### Arguments

| Name | Required | Description |
|---|---|---|
| `dir` | No | Path to agent-contracts.yaml. |

#### Options

| Option | Aliases | Required | Default | Description |
|---|---|---|---|---|
| `--config` | -c | No |  | Path to agent-contracts.config.yaml. |
| `--team` |  | No |  | Limit to one team (multi-team config only). |
| `--format` |  | No | `"text"` | Diagnostic output format. |
| `--quiet` |  | No | `false` | Suppress output on success. |
| `--strict` |  | No | `false` | Treat warnings as errors. |

#### Exit Codes

**Exit 0:** Validation passed. No errors found.

- **stdout:** format=`text`

**Exit 1:** Validation failed or unexpected error.

- **stderr:** format=`text`

#### Extensions

```yaml
x-agent: 
  riskLevel: low
  requiresConfirmation: false
  idempotent: true
  sideEffects: 

```

---

### lint

Run semantic lint rules on resolved DSL.

Runs TypeScript-based semantic lint rules and Spectral rules on the resolved DSL. Checks for best-practice violations, naming conventions, and structural issues beyond schema conformance.

**Usage:**

```
agent-contracts lint
```
```
agent-contracts lint path/to/agent-contracts.yaml
```
```
agent-contracts lint --strict
```
```
agent-contracts lint --format json
```

#### Arguments

| Name | Required | Description |
|---|---|---|
| `dir` | No | Path to agent-contracts.yaml. |

#### Options

| Option | Aliases | Required | Default | Description |
|---|---|---|---|---|
| `--config` | -c | No |  | Path to agent-contracts.config.yaml. |
| `--team` |  | No |  | Limit to one team (multi-team config only). |
| `--format` |  | No | `"text"` | Output format. |
| `--quiet` |  | No | `false` | Suppress output on success. |
| `--strict` |  | No | `false` | Treat warnings as errors. |

#### Exit Codes

**Exit 0:** Lint passed. No errors or warnings.

- **stdout:** format=`text`

**Exit 1:** Lint failed or unexpected error.

- **stderr:** format=`text`

#### Extensions

```yaml
x-agent: 
  riskLevel: low
  requiresConfirmation: false
  idempotent: true
  sideEffects: 

```

---

### render

Render resolved DSL with Handlebars templates.

Renders output files from the resolved DSL using Handlebars templates configured in agent-contracts.config.yaml. Supports drift detection via --check mode. Requires a config file.

**Usage:**

```
agent-contracts render -c agent-contracts.config.yaml
```
```
agent-contracts render -c agent-contracts.config.yaml --check
```
```
agent-contracts render --quiet
```

#### Options

| Option | Aliases | Required | Default | Description |
|---|---|---|---|---|
| `--config` | -c | No |  | Path to agent-contracts.config.yaml. |
| `--team` |  | No |  | Limit to one team (multi-team config only). |
| `--check` |  | No | `false` | Check for drift without writing files. |
| `--quiet` |  | No | `false` | Suppress output on success. |

#### Exit Codes

**Exit 0:** Render succeeded (or no drift detected in --check mode).

- **stdout:** format=`text`

**Exit 1:** Render failed, config not found, schema validation failed, or drift detected in --check mode.

- **stderr:** format=`text`

#### Extensions

```yaml
x-agent: 
  riskLevel: medium
  requiresConfirmation: false
  idempotent: true
  sideEffects: 
    - file_write
  recommendedBeforeUse: 
    - Ensure agent-contracts.config.yaml exists with render targets.
    - Run validate first to confirm DSL is valid.
```

---

### check

Run full pipeline — resolve, validate, lint, render --check.

Executes the complete verification pipeline in order: resolve DSL, validate schema and references, run lint rules, and check for render drift. Also verifies cross-team interface imports and team-interface.yaml drift when applicable.

**Usage:**

```
agent-contracts check -c agent-contracts.config.yaml
```
```
agent-contracts check -c agent-contracts.config.yaml --strict
```
```
agent-contracts check --format json --quiet
```

#### Options

| Option | Aliases | Required | Default | Description |
|---|---|---|---|---|
| `--config` | -c | No |  | Path to agent-contracts.config.yaml. |
| `--team` |  | No |  | Limit to one team (multi-team config only). |
| `--format` |  | No | `"text"` | Diagnostic output format. |
| `--quiet` |  | No | `false` | Suppress output on success. |
| `--strict` |  | No | `false` | Treat warnings as errors. |

#### Exit Codes

**Exit 0:** All checks passed.

- **stdout:** format=`text`

**Exit 1:** One or more checks failed — validation errors, lint errors, render drift, or missing interface files.

- **stderr:** format=`text`

#### Extensions

```yaml
x-agent: 
  riskLevel: low
  requiresConfirmation: false
  idempotent: true
  sideEffects: 

  recommendedBeforeUse: 
    - Ensure agent-contracts.config.yaml exists.
```

---

### score

Calculate DSL completeness score.

Evaluates the resolved DSL across 7 dimensions including artifact validation coverage, task validation coverage, guardrail policy coverage, workflow validation integration, schema completeness, cross-reference bidirectionality, and guardrail scope resolution. Returns a score out of 100 with optional CI gating via --threshold.

**Usage:**

```
agent-contracts score
```
```
agent-contracts score --format json
```
```
agent-contracts score --threshold 70
```
```
agent-contracts score -c agent-contracts.config.yaml
```

#### Arguments

| Name | Required | Description |
|---|---|---|
| `dir` | No | Path to agent-contracts.yaml. |

#### Options

| Option | Aliases | Required | Default | Description |
|---|---|---|---|---|
| `--config` | -c | No |  | Path to agent-contracts.config.yaml. |
| `--team` |  | No |  | Limit to one team (multi-team config only). |
| `--format` |  | No | `"text"` | Output format. |
| `--threshold` |  | No |  | Minimum score; exit 1 if below (for CI gates). |

#### Exit Codes

**Exit 0:** Score calculated (and above threshold if specified).

- **stdout:** format=`text`

**Exit 1:** Score below threshold, schema validation failed, or unexpected error.

- **stderr:** format=`text`

#### Extensions

```yaml
x-agent: 
  riskLevel: low
  requiresConfirmation: false
  idempotent: true
  sideEffects: 

```

---

### audit

Run LLM-based semantic audit on DSL definitions and generated outputs.

Performs LLM-based semantic analysis on DSL definitions and/or generated outputs. Three audit types are available: "render" checks whether generated files faithfully reflect the resolved DSL, "dsl" reviews DSL design for semantic coherence, and "prompt" verifies that generated prompts accurately express DSL intent. Uses agent-contracts-runtime (optional peer dependency) for LLM execution with handoff schema validation and follow-up recovery.

**Usage:**

```
agent-contracts audit render -c agent-contracts.config.yaml
```
```
agent-contracts audit dsl -c agent-contracts.config.yaml
```
```
agent-contracts audit prompt -c agent-contracts.config.yaml
```
```
agent-contracts audit all -c agent-contracts.config.yaml
```
```
agent-contracts audit dsl --dry-run -c agent-contracts.config.yaml
```
```
agent-contracts audit render --format json -c agent-contracts.config.yaml
```
```
agent-contracts audit dsl --scope agents:architect,implementer -c config.yaml
```

#### Arguments

| Name | Required | Description |
|---|---|---|
| `type` | No | Audit type to run: render (semantic diff of generated outputs vs DSL), dsl (design coherence review), prompt (generated prompt fidelity check), or all (run all three). |

#### Options

| Option | Aliases | Required | Default | Description |
|---|---|---|---|---|
| `--config` | -c | No |  | Path to agent-contracts.config.yaml. |
| `--team` |  | No |  | Limit to one team (multi-team config only). |
| `--format` |  | No | `"text"` | Output format. |
| `--scope` |  | No |  | Limit audit scope to specified entities (e.g. agents:architect,implementer). |
| `--dry-run` |  | No | `false` | Output the audit prompt without calling LLM. |
| `--adapter` |  | No |  | SDK adapter to use for LLM calls (overrides config audit.adapter). |
| `--model` |  | No |  | LLM model override (overrides config audit.model). |

#### Exit Codes

**Exit 0:** No critical findings detected.

- **stdout:** format=`text`

**Exit 1:** Critical findings detected.

- **stdout:** format=`text`

**Exit 2:** Invalid input or configuration error.

- **stderr:** format=`text`

**Exit 3:** LLM adapter error (API failure, runtime not installed).

- **stderr:** format=`text`

#### Extensions

```yaml
x-agent: 
  riskLevel: low
  requiresConfirmation: false
  idempotent: true
  sideEffects: 

  recommendedBeforeUse: 
    - Ensure agent-contracts.config.yaml exists with render targets.
    - Run validate first to confirm DSL is valid.
    - Install agent-contracts-runtime if not using --dry-run.
```

---

### generate

Generate guardrail or interface artifacts from DSL.

Generates runtime artifacts from the DSL. When type is "guardrails" (default), produces guardrail binding files from DSL, policies, and software bindings. When type is "interface", generates a team interface YAML/JSON file from the DSL's team_interface section.

**Usage:**

```
agent-contracts generate -c agent-contracts.config.yaml
```
```
agent-contracts generate guardrails -c agent-contracts.config.yaml
```
```
agent-contracts generate guardrails --binding cursor-rules
```
```
agent-contracts generate guardrails --dry-run
```
```
agent-contracts generate interface -c agent-contracts.config.yaml
```
```
agent-contracts generate interface --format json
```
```
agent-contracts generate interface -o team-interface.yaml --dry-run
```

#### Arguments

| Name | Required | Description |
|---|---|---|
| `type` | No | Type of artifacts to generate. |

#### Options

| Option | Aliases | Required | Default | Description |
|---|---|---|---|---|
| `--config` | -c | No |  | Path to agent-contracts.config.yaml. |
| `--team` |  | No |  | Limit to one team (multi-team config only). |
| `--binding` |  | No |  | Filter to specific software binding(s). Guardrails type only. |
| `--output` | -o | No |  | Output path for generated team interface. Interface type only. |
| `--format` |  | No | `"yaml"` | Output format for team interface (yaml or json). Interface type only. |
| `--dry-run` |  | No | `false` | Print what would be generated without writing files. |
| `--quiet` |  | No | `false` | Suppress output on success. |

#### Exit Codes

**Exit 0:** Generation succeeded.

- **stdout:** format=`text`

**Exit 1:** Generation failed — unknown type, schema validation failed, config not found, or error-level diagnostics.

- **stderr:** format=`text`

#### Extensions

```yaml
x-agent: 
  riskLevel: medium
  requiresConfirmation: false
  idempotent: true
  sideEffects: 
    - file_write
  recommendedBeforeUse: 
    - Ensure agent-contracts.config.yaml exists with binding definitions.
    - Run validate first to confirm DSL is valid.
```

---
