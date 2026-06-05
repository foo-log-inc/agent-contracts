import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  resolveArtifactBinding,
  type ArtifactBindingDiagnostic,
} from "../../src/resolver/artifact-binding.js";
import { resolveBound } from "../../src/resolver/bound-resolve.js";

const TEMP_DIR = join(tmpdir(), "agc-artifact-binding-test");

beforeEach(async () => {
  await mkdir(TEMP_DIR, { recursive: true });
});

afterEach(async () => {
  await rm(TEMP_DIR, { recursive: true, force: true });
});

function findDiagnostic(
  diagnostics: ArtifactBindingDiagnostic[],
  rule: ArtifactBindingDiagnostic["rule"],
  substring?: string,
): ArtifactBindingDiagnostic | undefined {
  return diagnostics.find(
    (d) => d.rule === rule && (substring === undefined || d.message.includes(substring)),
  );
}

describe("resolveArtifactBinding", () => {
  it("merges registry path_patterns over DSL defaults", () => {
    const dslArtifacts = {
      "openapi-spec": {
        type: "api-contract",
        path_patterns: ["specs/**/*.yaml"],
      },
    };
    const registry = {
      artifacts: {
        "openapi-spec": {
          path_patterns: ["specs/openapi.yaml"],
        },
      },
    };

    const result = resolveArtifactBinding(dslArtifacts, registry);
    const artifact = result.artifacts["openapi-spec"] as Record<string, unknown>;

    expect(artifact.path_patterns).toEqual(["specs/openapi.yaml"]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("preserves DSL-only fields after merge", () => {
    const dslArtifacts = {
      "openapi-spec": {
        type: "api-contract",
        required_validations: ["openapi-lint"],
        path_patterns: ["specs/**/*.yaml"],
      },
    };
    const registry = {
      artifacts: {
        "openapi-spec": {
          path_patterns: ["specs/openapi.yaml"],
        },
      },
    };

    const result = resolveArtifactBinding(dslArtifacts, registry);
    const artifact = result.artifacts["openapi-spec"] as Record<string, unknown>;

    expect(artifact.required_validations).toEqual(["openapi-lint"]);
    expect(artifact.path_patterns).toEqual(["specs/openapi.yaml"]);
  });

  it("adds registry-only fields such as x-domain", () => {
    const dslArtifacts = {
      "openapi-spec": {
        type: "api-contract",
        path_patterns: ["specs/**/*.yaml"],
      },
    };
    const registry = {
      artifacts: {
        "openapi-spec": {
          path_patterns: ["specs/openapi.yaml"],
          "x-domain": "billing",
        },
      },
    };

    const result = resolveArtifactBinding(dslArtifacts, registry);
    const artifact = result.artifacts["openapi-spec"] as Record<string, unknown>;

    expect(artifact["x-domain"]).toBe("billing");
  });

  it("maps DSL ID to a different registry ID via mappings", () => {
    const dslArtifacts = {
      "openapi-spec": {
        type: "api-contract",
        path_patterns: ["specs/**/*.yaml"],
      },
    };
    const registry = {
      artifacts: {
        billing_api_contract: {
          path_patterns: ["billing/openapi.yaml"],
          "x-domain": "billing",
        },
      },
    };

    const result = resolveArtifactBinding(dslArtifacts, registry, {
      "openapi-spec": "billing_api_contract",
    });
    const artifact = result.artifacts["openapi-spec"] as Record<string, unknown>;

    expect(artifact.path_patterns).toEqual(["billing/openapi.yaml"]);
    expect(artifact["x-domain"]).toBe("billing");
    expect(findDiagnostic(result.diagnostics, "orphan-binding")).toBeUndefined();
  });

  it("substitutes {var} patterns in path_patterns using paths", () => {
    const dslArtifacts = {
      "openapi-spec": {
        type: "api-contract",
        path_patterns: ["{api_dir}/openapi.yaml"],
      },
    };
    const registry = {
      artifacts: {
        "openapi-spec": {
          path_patterns: ["{api_dir}/openapi.yaml"],
        },
      },
    };

    const result = resolveArtifactBinding(dslArtifacts, registry, undefined, {
      api_dir: "specs/openapi",
    });
    const artifact = result.artifacts["openapi-spec"] as Record<string, unknown>;

    expect(artifact.path_patterns).toEqual(["specs/openapi/openapi.yaml"]);
  });

  it("emits unbound-artifact when DSL artifact has no registry match", () => {
    const dslArtifacts = {
      "missing-artifact": {
        type: "source",
        path_patterns: ["src/**"],
      },
    };
    const registry = { artifacts: {} };

    const result = resolveArtifactBinding(dslArtifacts, registry);
    const artifact = result.artifacts["missing-artifact"] as Record<string, unknown>;

    expect(artifact.path_patterns).toEqual(["src/**"]);
    expect(findDiagnostic(result.diagnostics, "unbound-artifact", "missing-artifact")).toBeDefined();
  });

  it("emits orphan-binding when registry artifact has no DSL match", () => {
    const dslArtifacts = {
      "openapi-spec": {
        type: "api-contract",
        path_patterns: ["specs/**/*.yaml"],
      },
    };
    const registry = {
      artifacts: {
        "openapi-spec": {
          path_patterns: ["specs/openapi.yaml"],
        },
        orphan_registry: {
          path_patterns: ["orphan/**"],
        },
      },
    };

    const result = resolveArtifactBinding(dslArtifacts, registry);

    expect(findDiagnostic(result.diagnostics, "orphan-binding", "orphan_registry")).toBeDefined();
  });

  it("emits type-mismatch when type conflicts", () => {
    const dslArtifacts = {
      "openapi-spec": {
        type: "api-contract",
        path_patterns: ["specs/**/*.yaml"],
      },
    };
    const registry = {
      artifacts: {
        "openapi-spec": {
          type: "source",
          path_patterns: ["specs/openapi.yaml"],
        },
      },
    };

    const result = resolveArtifactBinding(dslArtifacts, registry);

    expect(findDiagnostic(result.diagnostics, "type-mismatch", "type")).toBeDefined();
    expect(result.artifacts["openapi-spec"]).toBeDefined();
  });

  it("emits type-mismatch when authority conflicts", () => {
    const dslArtifacts = {
      "openapi-spec": {
        type: "api-contract",
        authority: "canonical",
        path_patterns: ["specs/**/*.yaml"],
      },
    };
    const registry = {
      artifacts: {
        "openapi-spec": {
          authority: "generated",
          path_patterns: ["specs/openapi.yaml"],
        },
      },
    };

    const result = resolveArtifactBinding(dslArtifacts, registry);

    expect(findDiagnostic(result.diagnostics, "type-mismatch", "authority")).toBeDefined();
  });

  it("deep-merges nested objects and replaces arrays from registry", () => {
    const dslArtifacts = {
      "config-artifact": {
        type: "config",
        metadata: {
          owner: "platform",
          tags: ["core", "shared"],
        },
        path_patterns: ["config/**"],
      },
    };
    const registry = {
      artifacts: {
        "config-artifact": {
          metadata: {
            team: "billing",
            tags: ["billing"],
          },
          path_patterns: ["config/billing/**"],
        },
      },
    };

    const result = resolveArtifactBinding(dslArtifacts, registry);
    const artifact = result.artifacts["config-artifact"] as Record<string, unknown>;
    const metadata = artifact.metadata as Record<string, unknown>;

    expect(metadata.owner).toBe("platform");
    expect(metadata.team).toBe("billing");
    expect(metadata.tags).toEqual(["billing"]);
    expect(artifact.path_patterns).toEqual(["config/billing/**"]);
  });

  it("processes multiple artifacts correctly", () => {
    const dslArtifacts = {
      "art-a": { type: "source", path_patterns: ["a/**"] },
      "art-b": { type: "source", path_patterns: ["b/**"] },
      "art-c": { type: "source", path_patterns: ["c/**"] },
    };
    const registry = {
      artifacts: {
        "art-a": { path_patterns: ["a/overridden/**"] },
        "art-b": { path_patterns: ["b/overridden/**"] },
      },
    };

    const result = resolveArtifactBinding(dslArtifacts, registry);

    expect(result.artifacts["art-a"]).toMatchObject({
      path_patterns: ["a/overridden/**"],
    });
    expect(result.artifacts["art-b"]).toMatchObject({
      path_patterns: ["b/overridden/**"],
    });
    expect(findDiagnostic(result.diagnostics, "unbound-artifact", "art-c")).toBeDefined();
  });
});

describe("resolveBound", () => {
  it("returns resolved DSL unchanged when artifact_binding is not configured", async () => {
    const resolvedDsl = {
      version: 1,
      artifacts: {
        "openapi-spec": {
          type: "api-contract",
          path_patterns: ["specs/**/*.yaml"],
        },
      },
    };

    const result = await resolveBound(resolvedDsl, {});

    expect(result.data).toBe(resolvedDsl);
    expect(result.diagnostics).toEqual([]);
  });

  it("loads artifact-contracts.yaml and merges artifacts", async () => {
    const registryPath = join(TEMP_DIR, "artifact-contracts.yaml");
    await writeFile(
      registryPath,
      `artifacts:
  billing_api_contract:
    type: api-contract
    path_patterns:
      - "{api_dir}/openapi.yaml"
    x-domain: billing
`,
    );

    const resolvedDsl = {
      version: 1,
      artifacts: {
        "openapi-spec": {
          type: "api-contract",
          required_validations: ["openapi-lint"],
          path_patterns: ["specs/**/*.yaml"],
        },
      },
    };

    const result = await resolveBound(resolvedDsl, {
      artifactBinding: {
        source: registryPath,
        mappings: {
          "openapi-spec": "billing_api_contract",
        },
      },
      paths: {
        api_dir: "specs/openapi",
      },
    });

    const artifact = result.data.artifacts as Record<string, Record<string, unknown>>;
    expect(artifact["openapi-spec"].path_patterns).toEqual(["specs/openapi/openapi.yaml"]);
    expect(artifact["openapi-spec"].required_validations).toEqual(["openapi-lint"]);
    expect(artifact["openapi-spec"]["x-domain"]).toBe("billing");
    expect(findDiagnostic(result.diagnostics, "orphan-binding")).toBeUndefined();
  });
});
