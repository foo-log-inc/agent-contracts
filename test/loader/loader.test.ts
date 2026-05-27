import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect } from "vitest";
import { loadDsl, DslLoadError } from "../../src/loader/index.js";

const fixturesDir = resolve(import.meta.dirname, "../fixtures");

describe("loadDsl", () => {
  describe("single file loading", () => {
    it("loads minimal fixture", async () => {
      const result = await loadDsl(join(fixturesDir, "minimal/agent-contracts.yaml"));
      expect(result.data).toBeDefined();
      expect(result.data["version"]).toBe(1);
      expect(result.data["system"]).toEqual({
        id: "minimal-system",
        name: "Minimal Agent Workflow",
        default_workflow_order: ["analyze", "implement"],
      });
      const agents = result.data["agents"] as Record<string, unknown>;
      expect(typeof agents).toBe("object");
      expect(agents["implementer"]).toBeDefined();
    });

    it("loads full fixture with x- properties", async () => {
      const result = await loadDsl(join(fixturesDir, "full/agent-contracts.yaml"));
      expect(result.data["version"]).toBe(1);
      expect(result.data["extends"]).toBe("@agent-contracts/base-team");
      const agents = result.data["agents"] as Record<string, Record<string, unknown>>;
      expect(Object.keys(agents).length).toBeGreaterThan(0);
      expect(agents["main-architect"]["x-identity"]).toBeDefined();
    });

    it("returns absolute filePath", async () => {
      const result = await loadDsl(join(fixturesDir, "minimal/agent-contracts.yaml"));
      expect(result.filePath).toBe(
        resolve(join(fixturesDir, "minimal/agent-contracts.yaml")),
      );
    });
  });

  describe("multi-file ($ref) loading", () => {
    it("resolves $ref for agents, tasks, artifacts", async () => {
      const result = await loadDsl(
        join(fixturesDir, "multifile/agent-contracts.yaml"),
      );
      expect(result.data["version"]).toBe(1);

      const agents = result.data["agents"] as Record<string, Record<string, unknown>>;
      expect(Object.keys(agents)).toHaveLength(1);
      expect(agents["implementer"]).toBeDefined();

      const tasks = result.data["tasks"] as Record<string, Record<string, unknown>>;
      expect(Object.keys(tasks)).toHaveLength(1);
      expect(tasks["implement-feature"]).toBeDefined();

      const artifacts = result.data["artifacts"] as Record<string, Record<string, unknown>>;
      expect(Object.keys(artifacts)).toHaveLength(1);
      expect(artifacts["codebase"]).toBeDefined();
    });

    it("resolves $ref relative to entry point directory", async () => {
      const result = await loadDsl(
        join(fixturesDir, "multifile/agent-contracts.yaml"),
      );
      const agents = result.data["agents"] as Record<string, Record<string, unknown>>;
      expect(agents["implementer"]["role_name"]).toBe("Implementer");
    });

    it("errors on $ref to non-existent file", async () => {
      const { writeFile, unlink } = await import("node:fs/promises");
      const tmpPath = join(tmpdir(), "_broken-ref.yaml");
      await writeFile(
        tmpPath,
        'version: 1\nsystem:\n  id: x\n  name: X\n  default_workflow_order: []\nagents: { $ref: "./nonexistent.yaml" }\n',
      );
      try {
        await expect(loadDsl(tmpPath)).rejects.toThrow(DslLoadError);
        await expect(loadDsl(tmpPath)).rejects.toThrow("File not found");
      } finally {
        await unlink(tmpPath);
      }
    });
  });

  describe("nested $ref (entry-level)", () => {
    it("resolves per-entry $ref within agents", async () => {
      const result = await loadDsl(
        join(fixturesDir, "multifile-nested/agent-contracts.yaml"),
      );
      const agents = result.data["agents"] as Record<string, Record<string, unknown>>;
      expect(Object.keys(agents)).toHaveLength(2);
      expect(agents["implementer"]["role_name"]).toBe("Implementer");
      expect(agents["implementer"]["purpose"]).toBe("Implements features");
      expect(agents["reviewer"]["role_name"]).toBe("Reviewer");
      expect(agents["reviewer"]["purpose"]).toBe("Reviews implementations");
    });
  });

  describe("directory $ref", () => {
    it("loads all YAML files from directory and merges", async () => {
      const result = await loadDsl(
        join(fixturesDir, "multifile-dir/agent-contracts.yaml"),
      );
      const agents = result.data["agents"] as Record<string, Record<string, unknown>>;
      expect(Object.keys(agents).sort()).toEqual(["architect", "implementer"]);
      expect(agents["architect"]["role_name"]).toBe("Architect");
      expect(agents["architect"]["can_invoke_agents"]).toEqual(["implementer"]);
      expect(agents["implementer"]["role_name"]).toBe("Implementer");
    });

    it("errors on duplicate keys across files in directory", async () => {
      await expect(
        loadDsl(join(fixturesDir, "multifile-dir-duplicate/agent-contracts.yaml")),
      ).rejects.toThrow(DslLoadError);
      await expect(
        loadDsl(join(fixturesDir, "multifile-dir-duplicate/agent-contracts.yaml")),
      ).rejects.toThrow("Conflicting value");
    });
  });

  describe("$refs (import + merge)", () => {
    it("merges inline entries with external file", async () => {
      const result = await loadDsl(
        join(fixturesDir, "refs-basic/agent-contracts.yaml"),
      );
      const agents = result.data["agents"] as Record<string, Record<string, unknown>>;
      expect(Object.keys(agents).sort()).toEqual([
        "architect",
        "implementer",
        "inline-agent",
      ]);
      expect(agents["inline-agent"]["role_name"]).toBe("Inline Agent");
      expect(agents["architect"]["role_name"]).toBe("Architect");
      expect(agents["implementer"]["role_name"]).toBe("Implementer");
    });

    it("$refs key is removed from output", async () => {
      const result = await loadDsl(
        join(fixturesDir, "refs-basic/agent-contracts.yaml"),
      );
      const agents = result.data["agents"] as Record<string, unknown>;
      expect("$refs" in agents).toBe(false);
    });

    it("deep-merges same keys across files at root level", async () => {
      const result = await loadDsl(
        join(fixturesDir, "refs-deep-merge/agent-contracts.yaml"),
      );
      const agents = result.data["agents"] as Record<string, Record<string, unknown>>;
      expect(agents["architect"]["role_name"]).toBe("Architect");
      expect(agents["architect"]["purpose"]).toBe("Drives phases");
      expect(agents["architect"]["constraints"]).toEqual(["Never write code directly"]);
      expect(agents["implementer"]["role_name"]).toBe("Implementer");
      expect(agents["implementer"]["constraints"]).toEqual(["Follow spec strictly"]);

      const artifacts = result.data["artifacts"] as Record<string, Record<string, unknown>>;
      expect(artifacts["spec-md"]["type"]).toBe("document");
    });

    it("loads directory entries in $refs list", async () => {
      const result = await loadDsl(
        join(fixturesDir, "refs-dir/agent-contracts.yaml"),
      );
      const agents = result.data["agents"] as Record<string, Record<string, unknown>>;
      expect(Object.keys(agents).sort()).toEqual([
        "architect",
        "implementer",
        "inline-agent",
      ]);
      expect(agents["architect"]["purpose"]).toBe("Drives phases and delegates work");
      expect(agents["inline-agent"]["role_name"]).toBe("Inline");
    });

    it("errors on conflicting leaf values across $refs files", async () => {
      await expect(
        loadDsl(join(fixturesDir, "refs-conflict/agent-contracts.yaml")),
      ).rejects.toThrow(DslLoadError);
      await expect(
        loadDsl(join(fixturesDir, "refs-conflict/agent-contracts.yaml")),
      ).rejects.toThrow("Conflicting value");
    });
  });

  describe("version check", () => {
    it("rejects missing version", async () => {
      await expect(
        loadDsl(join(fixturesDir, "invalid/missing-version.yaml")),
      ).rejects.toThrow("Missing DSL version");
    });

    it("rejects wrong version number", async () => {
      await expect(
        loadDsl(join(fixturesDir, "invalid/wrong-version.yaml")),
      ).rejects.toThrow("Unsupported DSL version");
      await expect(
        loadDsl(join(fixturesDir, "invalid/wrong-version.yaml")),
      ).rejects.toThrow("expected 1, got 2");
    });

    it("rejects version as string", async () => {
      await expect(
        loadDsl(join(fixturesDir, "invalid/bad-type.yaml")),
      ).rejects.toThrow("Unsupported DSL version");
    });
  });

  describe("error handling", () => {
    it("errors on non-existent file", async () => {
      await expect(
        loadDsl("/tmp/agent-contracts-nonexistent-file.yaml"),
      ).rejects.toThrow(DslLoadError);
      await expect(
        loadDsl("/tmp/agent-contracts-nonexistent-file.yaml"),
      ).rejects.toThrow("File not found");
    });

    it("errors on invalid YAML syntax", async () => {
      await expect(
        loadDsl(join(fixturesDir, "invalid/bad-yaml-syntax.yaml")),
      ).rejects.toThrow(DslLoadError);
      await expect(
        loadDsl(join(fixturesDir, "invalid/bad-yaml-syntax.yaml")),
      ).rejects.toThrow("Invalid YAML syntax");
    });
  });

  describe("JSON Pointer $ref resolution", () => {
    it("resolves #/ references to components.schemas", async () => {
      const result = await loadDsl(
        join(fixturesDir, "json-pointer-ref/agent-contracts.yaml"),
      );
      const handoffTypes = result.data["handoff_types"] as Record<string, Record<string, unknown>>;
      const delegation = handoffTypes["task-delegation"];
      const schema = delegation["schema"] as Record<string, unknown>;

      const allOf = schema["allOf"] as Array<Record<string, unknown>>;
      expect(allOf).toHaveLength(2);
      expect(allOf[0]["type"]).toBe("object");
      expect(allOf[0]["required"]).toEqual(["from_agent", "to_agent"]);
      const commonProps = allOf[0]["properties"] as Record<string, unknown>;
      expect(commonProps["from_agent"]).toEqual({ type: "string" });
      expect(commonProps["to_agent"]).toEqual({ type: "string" });
      expect(commonProps["run_id"]).toEqual({ type: "string" });
    });

    it("resolves #/ references independently per usage (deep copy)", async () => {
      const result = await loadDsl(
        join(fixturesDir, "json-pointer-ref/agent-contracts.yaml"),
      );
      const handoffTypes = result.data["handoff_types"] as Record<string, Record<string, unknown>>;
      const delegationSchema = handoffTypes["task-delegation"]["schema"] as Record<string, unknown>;
      const resultSchema = handoffTypes["implementation-result"]["schema"] as Record<string, unknown>;

      const delegationAllOf = delegationSchema["allOf"] as Array<Record<string, unknown>>;
      const resultAllOf = resultSchema["allOf"] as Array<Record<string, unknown>>;

      expect(delegationAllOf[0]).toEqual(resultAllOf[0]);
      expect(delegationAllOf[0]).not.toBe(resultAllOf[0]);
    });

    it("errors on non-existent JSON Pointer path", async () => {
      const { writeFileSync, unlinkSync } = await import("node:fs");
      const tempPath = join(tmpdir(), "temp-bad-ref.yaml");
      writeFileSync(tempPath, `version: 1\nsystem:\n  id: t\n  name: T\n  default_workflow_order: []\nhandoff_types:\n  h:\n    version: 1\n    schema:\n      $ref: "#/components/schemas/nonexistent"\n`);
      try {
        await expect(loadDsl(tempPath)).rejects.toThrow("not found");
      } finally {
        unlinkSync(tempPath);
      }
    });
  });

  describe("file $ref with JSON Pointer fragment (file.yaml#/path)", () => {
    it("resolves external file with fragment", async () => {
      const result = await loadDsl(
        join(fixturesDir, "file-fragment-ref/agent-contracts.yaml"),
      );
      const handoffTypes = result.data["handoff_types"] as Record<string, Record<string, unknown>>;
      const workResult = handoffTypes["work-result"];
      const schema = workResult["schema"] as Record<string, unknown>;

      expect(schema["type"]).toBe("object");
      expect(schema["required"]).toEqual(["summary"]);
      const props = schema["properties"] as Record<string, unknown>;
      expect(props["summary"]).toEqual({ type: "string" });
      expect(props["details"]).toEqual({
        type: "object",
        additionalProperties: true,
      });
    });

    it("resolves internal $ref within an externally-loaded file", async () => {
      const { writeFileSync, unlinkSync } = await import("node:fs");
      const tempDsl = join(tmpdir(), "temp-internal-ref.yaml");
      const tempComp = join(tmpdir(), "temp-components.yaml");
      writeFileSync(tempComp, [
        "schemas:",
        "  base:",
        "    type: object",
        "    properties:",
        "      id:",
        "        type: string",
        "  extended:",
        "    type: object",
        "    properties:",
        "      base:",
        '        $ref: "#/schemas/base"',
        "      extra:",
        "        type: string",
      ].join("\n"));
      writeFileSync(tempDsl, [
        "version: 1",
        "system:",
        "  id: t",
        "  name: T",
        "  default_workflow_order: []",
        "handoff_types:",
        "  h:",
        "    version: 1",
        "    schema:",
        "      $ref: './temp-components.yaml#/schemas/extended'",
      ].join("\n"));
      try {
        const result = await loadDsl(tempDsl);
        const ht = result.data["handoff_types"] as Record<string, Record<string, unknown>>;
        const schema = ht["h"]["schema"] as Record<string, unknown>;
        expect(schema["type"]).toBe("object");
        const props = schema["properties"] as Record<string, unknown>;
        expect(props["extra"]).toEqual({ type: "string" });
        const base = props["base"] as Record<string, unknown>;
        expect(base["type"]).toBe("object");
        expect((base["properties"] as Record<string, unknown>)["id"]).toEqual({ type: "string" });
      } finally {
        unlinkSync(tempDsl);
        unlinkSync(tempComp);
      }
    });

    it("errors on file $ref with fragment pointing to non-existent path", async () => {
      const { writeFileSync, unlinkSync } = await import("node:fs");
      const tempDsl = join(tmpdir(), "temp-bad-fragment.yaml");
      writeFileSync(tempDsl, [
        "version: 1",
        "system:",
        "  id: t",
        "  name: T",
        "  default_workflow_order: []",
        "handoff_types:",
        "  h:",
        "    version: 1",
        "    schema:",
        "      $ref: './components.yaml#/schemas/nonexistent'",
      ].join("\n"));
      try {
        await expect(loadDsl(tempDsl)).rejects.toThrow("not found");
      } finally {
        unlinkSync(tempDsl);
      }
    });
  });
});
