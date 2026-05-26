import { describe, expect, it } from "vitest";
import {
  BindingOutputSchema,
  BindingRenderTargetSchema,
  CheckSchema,
  GuardrailPolicyRuleEscalationSchema,
  GuardrailPolicyRuleSchema,
  GuardrailPolicySchema,
  GuardrailSchema,
  MatcherSchema,
  ReportingSchema,
  SoftwareBindingSchema,
} from "../../src/schema/index.js";

describe("GuardrailSchema", () => {
  it("parses minimal valid guardrail (description + scope only)", () => {
    const g = GuardrailSchema.parse({
      description: "No secrets in prompts",
      scope: {},
    });
    expect(g.description).toBe("No secrets in prompts");
    expect(g.scope).toEqual({});
    expect(g.tags).toEqual([]);
  });

  it("parses full guardrail with all fields", () => {
    const g = GuardrailSchema.parse({
      description: "Full guardrail",
      scope: {
        agents: ["architect"],
        tasks: ["implement"],
        tools: ["bash"],
        artifacts: ["spec.md"],
        workflows: ["implement"],
      },
      rationale: "Security baseline",
      tags: ["security", "pii"],
      exemptions: ["emergency-break-glass"],
    });
    expect(g.scope.agents).toEqual(["architect"]);
    expect(g.scope.tasks).toEqual(["implement"]);
    expect(g.scope.tools).toEqual(["bash"]);
    expect(g.scope.artifacts).toEqual(["spec.md"]);
    expect(g.scope.workflows).toEqual(["implement"]);
    expect(g.rationale).toBe("Security baseline");
    expect(g.tags).toEqual(["security", "pii"]);
    expect(g.exemptions).toEqual(["emergency-break-glass"]);
  });

  it("defaults tags to [] when omitted", () => {
    const g = GuardrailSchema.parse({
      description: "d",
      scope: {},
    });
    expect(g.tags).toEqual([]);
  });

  it("rejects missing description", () => {
    const r = GuardrailSchema.safeParse({ scope: {} });
    expect(r.success).toBe(false);
  });

  it("rejects missing scope", () => {
    const r = GuardrailSchema.safeParse({ description: "d" });
    expect(r.success).toBe(false);
  });

  it("allows x- passthrough properties", () => {
    const g = GuardrailSchema.parse({
      description: "d",
      scope: {},
      "x-guardrail-meta": { tier: 1 },
    });
    expect((g as Record<string, unknown>)["x-guardrail-meta"]).toEqual({
      tier: 1,
    });
  });

  it("scope allows passthrough properties", () => {
    const g = GuardrailSchema.parse({
      description: "d",
      scope: { agents: ["a"], "x-scope-extra": true },
    });
    expect((g.scope as Record<string, unknown>)["x-scope-extra"]).toBe(true);
  });
});

describe("GuardrailPolicySchema", () => {
  const minimalRule = {
    guardrail: "gr-1",
    severity: "mandatory" as const,
    action: "warn" as const,
  };

  it("parses minimal policy (rules array with one rule)", () => {
    const p = GuardrailPolicySchema.parse({
      rules: [minimalRule],
    });
    expect(p.rules).toHaveLength(1);
    expect(p.rules[0].allow_override).toBe(false);
  });

  it("parses full policy with description and multiple rules", () => {
    const p = GuardrailPolicySchema.parse({
      description: "Org defaults",
      rules: [
        { ...minimalRule, guardrail: "a" },
        {
          guardrail: "b",
          severity: "info",
          action: "info",
          allow_override: true,
          override_requires: ["lead"],
        },
      ],
    });
    expect(p.description).toBe("Org defaults");
    expect(p.rules).toHaveLength(2);
    expect(p.rules[1].override_requires).toEqual(["lead"]);
  });

  it("accepts all severity values", () => {
    const severities = ["critical", "mandatory", "warning", "info"] as const;
    for (const severity of severities) {
      const p = GuardrailPolicySchema.parse({
        rules: [{ guardrail: "g", severity, action: "info" }],
      });
      expect(p.rules[0].severity).toBe(severity);
    }
  });

  it("accepts all action values", () => {
    const actions = ["block", "warn", "shadow", "info"] as const;
    for (const action of actions) {
      const p = GuardrailPolicySchema.parse({
        rules: [{ guardrail: "g", severity: "info", action }],
      });
      expect(p.rules[0].action).toBe(action);
    }
  });

  it("defaults allow_override to false", () => {
    const p = GuardrailPolicySchema.parse({ rules: [minimalRule] });
    expect(p.rules[0].allow_override).toBe(false);
  });

  it("parses escalation with target and condition", () => {
    const p = GuardrailPolicySchema.parse({
      rules: [
        {
          ...minimalRule,
          escalation: { target: "human-review", condition: "twice" },
        },
      ],
    });
    expect(p.rules[0].escalation).toEqual({
      target: "human-review",
      condition: "twice",
    });
  });

  it("rejects invalid severity", () => {
    const r = GuardrailPolicyRuleSchema.safeParse({
      guardrail: "g",
      severity: "fatal",
      action: "block",
    });
    expect(r.success).toBe(false);
  });

  it("rejects invalid action", () => {
    const r = GuardrailPolicyRuleSchema.safeParse({
      guardrail: "g",
      severity: "critical",
      action: "halt",
    });
    expect(r.success).toBe(false);
  });

  it("parses string action (backward compat)", () => {
    const r = GuardrailPolicyRuleSchema.parse({
      guardrail: "g",
      severity: "critical",
      action: "block",
    });
    expect(r.action).toBe("block");
  });

  it("parses conditional action object", () => {
    const r = GuardrailPolicyRuleSchema.parse({
      guardrail: "g",
      severity: "critical",
      action: { default: "block", when: { maintenance: "shadow" } },
    });
    expect(r.action).toEqual({
      default: "block",
      when: { maintenance: "shadow" },
    });
  });

  it("rejects invalid default in conditional action", () => {
    const r = GuardrailPolicyRuleSchema.safeParse({
      guardrail: "g",
      severity: "critical",
      action: { default: "invalid" },
    });
    expect(r.success).toBe(false);
  });

  it("rejects invalid when values in conditional action", () => {
    const r = GuardrailPolicyRuleSchema.safeParse({
      guardrail: "g",
      severity: "critical",
      action: { default: "block", when: { maintenance: "invalid" } },
    });
    expect(r.success).toBe(false);
  });

  it("accepts empty when in conditional action", () => {
    const r = GuardrailPolicyRuleSchema.parse({
      guardrail: "g",
      severity: "critical",
      action: { default: "block", when: {} },
    });
    expect(r.action).toEqual({ default: "block", when: {} });
  });

  it("rejects conditional action missing when field", () => {
    const r = GuardrailPolicyRuleSchema.safeParse({
      guardrail: "g",
      severity: "critical",
      action: { default: "block" },
    });
    expect(r.success).toBe(false);
  });

  it("rejects conditional action missing default field", () => {
    const r = GuardrailPolicyRuleSchema.safeParse({
      guardrail: "g",
      severity: "critical",
      action: { when: { maintenance: "shadow" } },
    });
    expect(r.success).toBe(false);
  });

  it("rejects missing guardrail in rule", () => {
    const r = GuardrailPolicyRuleSchema.safeParse({
      severity: "critical",
      action: "block",
    });
    expect(r.success).toBe(false);
  });

  it("allows passthrough on policy and rules", () => {
    const p = GuardrailPolicySchema.parse({
      rules: [
        {
          ...minimalRule,
          "x-rule-note": "alpha",
        },
      ],
      "x-policy-note": "beta",
    });
    expect((p as Record<string, unknown>)["x-policy-note"]).toBe("beta");
    expect((p.rules[0] as Record<string, unknown>)["x-rule-note"]).toBe(
      "alpha",
    );
  });
});

describe("GuardrailPolicyRuleEscalationSchema", () => {
  it("parses minimal escalation", () => {
    const e = GuardrailPolicyRuleEscalationSchema.parse({
      target: "owner",
    });
    expect(e.target).toBe("owner");
    expect(e.condition).toBeUndefined();
  });

  it("allows passthrough on escalation", () => {
    const e = GuardrailPolicyRuleEscalationSchema.parse({
      target: "t",
      "x-esc": 1,
    });
    expect((e as Record<string, unknown>)["x-esc"]).toBe(1);
  });
});

describe("MatcherSchema", () => {
  it("parses command_regex matcher", () => {
    const m = MatcherSchema.parse({
      type: "command_regex",
      pattern: "^rm\\s",
    });
    expect(m.type).toBe("command_regex");
    if (m.type === "command_regex") {
      expect(m.pattern).toBe("^rm\\s");
    }
  });

  it("parses content_regex matcher with file_glob and exclude_glob", () => {
    const m = MatcherSchema.parse({
      type: "content_regex",
      pattern: "API_KEY",
      file_glob: "**/*.ts",
      exclude_glob: "**/vendor/**",
    });
    expect(m.type).toBe("content_regex");
    if (m.type === "content_regex") {
      expect(m.pattern).toBe("API_KEY");
      expect(m.file_glob).toBe("**/*.ts");
      expect(m.exclude_glob).toBe("**/vendor/**");
    }
  });

  it("parses file_glob matcher", () => {
    const m = MatcherSchema.parse({
      type: "file_glob",
      pattern: "*.pem",
    });
    expect(m.type).toBe("file_glob");
    if (m.type === "file_glob") {
      expect(m.pattern).toBe("*.pem");
    }
  });

  it("rejects unknown type", () => {
    const r = MatcherSchema.safeParse({
      type: "unknown_matcher",
      pattern: "x",
    });
    expect(r.success).toBe(false);
  });
});

describe("CheckSchema", () => {
  it("parses with matcher only", () => {
    const c = CheckSchema.parse({
      matcher: { type: "file_glob", pattern: "*.key" },
    });
    expect(c.matcher?.type).toBe("file_glob");
  });

  it("parses with script only", () => {
    const c = CheckSchema.parse({ script: "scripts/check.sh" });
    expect(c.script).toBe("scripts/check.sh");
  });

  it("parses with message", () => {
    const c = CheckSchema.parse({ message: "Do not commit credentials" });
    expect(c.message).toBe("Do not commit credentials");
  });

  it("allows passthrough fields (hook_event, git_hook, etc.)", () => {
    const c = CheckSchema.parse({
      hook_event: "pre_commit",
      git_hook: "pre-commit",
    });
    expect((c as Record<string, unknown>).hook_event).toBe("pre_commit");
    expect((c as Record<string, unknown>).git_hook).toBe("pre-commit");
  });

  it("parses empty check (all optional)", () => {
    const c = CheckSchema.parse({});
    expect(c.matcher).toBeUndefined();
    expect(c.script).toBeUndefined();
    expect(c.message).toBeUndefined();
  });
});

describe("BindingOutputSchema", () => {
  it("parses with template", () => {
    const o = BindingOutputSchema.parse({
      target: "out.md",
      template: "tmpl.md",
    });
    expect(o.template).toBe("tmpl.md");
    expect(o.inline_template).toBeUndefined();
  });

  it("parses with inline_template", () => {
    const o = BindingOutputSchema.parse({
      target: "out.md",
      inline_template: "{{name}}",
    });
    expect(o.inline_template).toBe("{{name}}");
  });

  it('defaults mode to "write"', () => {
    const o = BindingOutputSchema.parse({ target: "t" });
    expect(o.mode).toBe("write");
  });

  it('accepts mode "patch"', () => {
    const o = BindingOutputSchema.parse({
      target: "t",
      mode: "patch",
    });
    expect(o.mode).toBe("patch");
  });

  it("parses with source (file copy)", () => {
    const o = BindingOutputSchema.parse({
      target: "out.lua",
      source: "scripts/enrich.lua",
    });
    expect(o.source).toBe("scripts/enrich.lua");
    expect(o.template).toBeUndefined();
    expect(o.inline_template).toBeUndefined();
  });

  it("rejects both template AND inline_template (mutual exclusion refine)", () => {
    const r = BindingOutputSchema.safeParse({
      target: "t",
      template: "a",
      inline_template: "b",
    });
    expect(r.success).toBe(false);
  });

  it("rejects template AND source together", () => {
    const r = BindingOutputSchema.safeParse({
      target: "t",
      template: "a",
      source: "b",
    });
    expect(r.success).toBe(false);
  });

  it("rejects inline_template AND source together", () => {
    const r = BindingOutputSchema.safeParse({
      target: "t",
      inline_template: "a",
      source: "b",
    });
    expect(r.success).toBe(false);
  });

  it("rejects all three specified", () => {
    const r = BindingOutputSchema.safeParse({
      target: "t",
      template: "a",
      inline_template: "b",
      source: "c",
    });
    expect(r.success).toBe(false);
  });

  it("parses patch mode with format and patch_strategy", () => {
    const o = BindingOutputSchema.parse({
      target: "config.json",
      template: "patch.json.hbs",
      mode: "patch",
      format: "json",
      patch_strategy: "deep_merge",
    });
    expect(o.mode).toBe("patch");
    expect(o.format).toBe("json");
    expect(o.patch_strategy).toBe("deep_merge");
  });

  it("parses patch mode with array_merge_key", () => {
    const o = BindingOutputSchema.parse({
      target: "hooks.json",
      inline_template: "[]",
      mode: "patch",
      format: "json",
      patch_strategy: "deep_merge",
      array_merge_key: "id",
    });
    expect(o.array_merge_key).toBe("id");
  });

  it("accepts format yaml", () => {
    const o = BindingOutputSchema.parse({
      target: "config.yaml",
      inline_template: "x",
      mode: "patch",
      format: "yaml",
    });
    expect(o.format).toBe("yaml");
  });

  it("accepts format text", () => {
    const o = BindingOutputSchema.parse({
      target: "log.txt",
      inline_template: "x",
      mode: "patch",
      format: "text",
    });
    expect(o.format).toBe("text");
  });

  it("parses with group_by and executable", () => {
    const o = BindingOutputSchema.parse({
      target: "reports/*.md",
      group_by: "session",
      executable: false,
    });
    expect(o.group_by).toBe("session");
    expect(o.executable).toBe(false);
  });

  it("allows passthrough", () => {
    const o = BindingOutputSchema.parse({
      target: "t",
      "x-output-meta": { priority: 2 },
    });
    expect((o as Record<string, unknown>)["x-output-meta"]).toEqual({
      priority: 2,
    });
  });
});

describe("ReportingSchema", () => {
  it("parses with commands, defaults fail_open and timeout_ms", () => {
    const r = ReportingSchema.parse({
      commands: { lint: "npm run lint" },
    });
    expect(r.commands).toEqual({ lint: "npm run lint" });
    expect(r.fail_open).toBe(true);
    expect(r.timeout_ms).toBe(5000);
  });

  it("parses with explicit fail_open and timeout_ms", () => {
    const r = ReportingSchema.parse({
      commands: { a: "b" },
      fail_open: false,
      timeout_ms: 12000,
    });
    expect(r.fail_open).toBe(false);
    expect(r.timeout_ms).toBe(12000);
  });

  it("rejects missing commands", () => {
    const r = ReportingSchema.safeParse({
      fail_open: true,
      timeout_ms: 1000,
    });
    expect(r.success).toBe(false);
  });

  it("allows passthrough", () => {
    const r = ReportingSchema.parse({
      commands: { x: "y" },
      "x-reporting": true,
    });
    expect((r as Record<string, unknown>)["x-reporting"]).toBe(true);
  });
});

describe("SoftwareBindingSchema", () => {
  it("parses minimal binding (software + version: 1)", () => {
    const b = SoftwareBindingSchema.parse({
      software: "cursor-hooks",
      version: 1,
    });
    expect(b.software).toBe("cursor-hooks");
    expect(b.version).toBe(1);
  });

  it("parses full binding with guardrail_impl, outputs, reporting, extends", () => {
    const b = SoftwareBindingSchema.parse({
      software: "observ-cli",
      version: 1,
      extends: "@org/base-binding",
      guardrail_impl: {
        "no-secrets": {
          checks: [
            {
              matcher: { type: "content_regex", pattern: "BEGIN RSA" },
            },
          ],
        },
      },
      outputs: {
        report: {
          target: "quality.md",
          template: "tmpl.md",
          mode: "patch",
        },
      },
      reporting: {
        commands: { emit: "observ emit" },
        fail_open: false,
        timeout_ms: 3000,
      },
    });
    expect(b.extends).toBe("@org/base-binding");
    expect(Object.keys(b.guardrail_impl ?? {})).toEqual(["no-secrets"]);
    expect(b.outputs?.report.mode).toBe("patch");
    expect(b.reporting?.commands.emit).toBe("observ emit");
  });

  it("rejects wrong version number", () => {
    const r = SoftwareBindingSchema.safeParse({
      software: "s",
      version: 2,
    });
    expect(r.success).toBe(false);
  });

  it("rejects missing software", () => {
    const r = SoftwareBindingSchema.safeParse({
      version: 1,
    });
    expect(r.success).toBe(false);
  });

  it("allows passthrough", () => {
    const b = SoftwareBindingSchema.parse({
      software: "s",
      version: 1,
      "x-binding-meta": "extra",
    });
    expect((b as Record<string, unknown>)["x-binding-meta"]).toBe("extra");
  });

  it("accepts renders array in binding", () => {
    const b = SoftwareBindingSchema.parse({
      software: "cursor",
      version: 1,
      renders: [
        {
          context: "agent",
          output: "{cursor_root}/{agent.id}.md",
          inline_template: "# {{agent.role_name}}",
        },
        {
          context: "system",
          output: "sys.md",
          template: "./templates/sys.hbs",
        },
      ],
    });
    expect(b.renders).toHaveLength(2);
    expect(b.renders![0].context).toBe("agent");
    expect(b.renders![1].context).toBe("system");
  });

  it("accepts binding with no renders", () => {
    const b = SoftwareBindingSchema.parse({
      software: "s",
      version: 1,
    });
    expect(b.renders).toBeUndefined();
  });
});

describe("BindingRenderTargetSchema", () => {
  it("parses valid render target with inline_template", () => {
    const r = BindingRenderTargetSchema.parse({
      context: "agent",
      output: "{out}/{agent.id}.md",
      inline_template: "# {{agent.role_name}}",
    });
    expect(r.context).toBe("agent");
    expect(r.inline_template).toContain("role_name");
  });

  it("parses valid render target with template file", () => {
    const r = BindingRenderTargetSchema.parse({
      context: "system",
      output: "out.md",
      template: "./templates/sys.hbs",
    });
    expect(r.template).toBe("./templates/sys.hbs");
  });

  it("rejects when both template and inline_template are set", () => {
    const r = BindingRenderTargetSchema.safeParse({
      context: "system",
      output: "out.md",
      template: "t.hbs",
      inline_template: "x",
    });
    expect(r.success).toBe(false);
  });

  it("rejects when neither template nor inline_template is set", () => {
    const r = BindingRenderTargetSchema.safeParse({
      context: "system",
      output: "out.md",
    });
    expect(r.success).toBe(false);
  });

  it("rejects when both include and exclude are set", () => {
    const r = BindingRenderTargetSchema.safeParse({
      context: "agent",
      output: "{agent.id}.md",
      inline_template: "x",
      include: ["a"],
      exclude: ["b"],
    });
    expect(r.success).toBe(false);
  });

  it("rejects include/exclude with system context", () => {
    const r = BindingRenderTargetSchema.safeParse({
      context: "system",
      output: "out.md",
      inline_template: "x",
      include: ["a"],
    });
    expect(r.success).toBe(false);
  });

  it("accepts all valid context types", () => {
    for (const ctx of ["agent", "task", "artifact", "tool", "workflow", "system"]) {
      const r = BindingRenderTargetSchema.safeParse({
        context: ctx,
        output: "out.md",
        inline_template: "x",
      });
      expect(r.success).toBe(true);
    }
  });

  it("allows passthrough fields", () => {
    const r = BindingRenderTargetSchema.parse({
      context: "system",
      output: "out.md",
      inline_template: "x",
      "x-custom": "meta",
    });
    expect((r as Record<string, unknown>)["x-custom"]).toBe("meta");
  });
});
