#!/usr/bin/env node
/**
 * Single-file bundle builder for agent-contracts CLI.
 *
 * Produces dist/agent-contracts.bundle.mjs — a self-contained CLI that only
 * requires Node.js 20+ and agent-contracts-runtime (which handles LLM SDK
 * adapter loading internally via its own dynamic imports).
 *
 * Usage:
 *   node esbuild.bundle.mjs            # normal bundle
 *   node esbuild.bundle.mjs --minify   # minified bundle
 */

import { build } from "esbuild";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const minify = process.argv.includes("--minify");

// LLM SDK packages and runtime — kept external so the bundle user installs only what they need.
const externalSdks = [
  "@anthropic-ai/claude-agent-sdk",
  "@anthropic-ai/sdk",
  "@openai/agents",
  "@google/adk",
  "@google/genai",
];

/**
 * Plugin: no-op (formerly resolved RUNTIME_PKG obfuscation, no longer needed).
 */
const resolveRuntimeDynamicImports = {
  name: "resolve-runtime-dynamic-imports",
  setup(_build) {},
};

/**
 * Plugin: inline package version at build time.
 *
 * cli.ts reads package.json at runtime via readFileSync + __dirname.
 * Replace that with a compile-time constant.
 */
const inlinePackageVersion = {
  name: "inline-package-version",
  setup(build) {
    build.onLoad({ filter: /cli[\\/]cli\.ts$/ }, async (args) => {
      let contents = readFileSync(args.path, "utf8");

      // Strip the source shebang (banner provides it)
      contents = contents.replace(/^#!.*\n/, "");

      // Replace the runtime package.json read block with a constant
      contents = contents.replace(
        /const __dirname = .*\n.*const pkg = .*\n/,
        `const pkg = { version: ${JSON.stringify(pkg.version)} };\n`,
      );

      return { contents, loader: "ts" };
    });
  },
};

const result = await build({
  entryPoints: ["src/cli/cli.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  outfile: "dist/agent-contracts.bundle.mjs",
  minify,
  sourcemap: true,

  // Keep LLM SDK packages external — user installs only what they use
  external: externalSdks,

  // Prefer ESM entry points to avoid CJS relative-require issues in the bundle
  mainFields: ["module", "main"],
  conditions: ["import", "node"],

  banner: {
    js: [
      "#!/usr/bin/env node",
      "import { createRequire as __banner_createRequire } from 'module';",
      "const require = __banner_createRequire(import.meta.url);",
    ].join("\n"),
  },

  plugins: [resolveRuntimeDynamicImports, inlinePackageVersion],

  // Deduplicate logs
  logLevel: "info",
});

if (result.errors.length > 0) {
  process.exit(1);
}

// Report sizes
const { statSync } = await import("node:fs");
const stat = statSync("dist/agent-contracts.bundle.mjs");
const sizeKB = (stat.size / 1024).toFixed(1);
const sizeMB = (stat.size / 1024 / 1024).toFixed(2);
console.log(`\n✓ dist/agent-contracts.bundle.mjs  ${sizeKB} KB (${sizeMB} MB)`);
