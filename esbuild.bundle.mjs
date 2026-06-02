#!/usr/bin/env node
/**
 * Single-file bundle builder for agent-contracts CLI.
 *
 * Produces dist/agent-contracts.bundle.mjs — a self-contained CLI that only
 * requires Node.js 20+ and (optionally) the LLM SDK packages that are kept
 * external: @anthropic-ai/claude-agent-sdk, @cursor/sdk, @openai/agents,
 * @google/genai.
 *
 * Usage:
 *   node esbuild.bundle.mjs            # normal bundle
 *   node esbuild.bundle.mjs --minify   # minified bundle
 */

import { build } from "esbuild";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const minify = process.argv.includes("--minify");

// LLM SDK packages — kept external so the bundle user installs only what they need.
const externalSdks = [
  "@anthropic-ai/claude-agent-sdk",
  "@anthropic-ai/sdk",
  "@cursor/sdk",
  "@openai/agents",
  "@google/genai",
];

/**
 * Plugin: resolve the obfuscated dynamic imports in auditor.ts.
 *
 * The source uses `const RUNTIME_PKG = ["agent-contracts","runtime"].join("-")`
 * followed by `await import(RUNTIME_PKG)` and template-literal adapter imports
 * to prevent TypeScript from resolving them at compile time.  For bundling we
 * need esbuild to see literal specifiers so it can follow the imports.
 */
const resolveRuntimeDynamicImports = {
  name: "resolve-runtime-dynamic-imports",
  setup(build) {
    build.onLoad({ filter: /auditor[\\/]auditor\.ts$/ }, async (args) => {
      let contents = readFileSync(args.path, "utf8");

      // 1. Remove the obfuscated variable declaration
      contents = contents.replace(
        /const RUNTIME_PKG = \["agent-contracts",\s*"runtime"\]\.join\("-"\);/,
        "",
      );

      // 2. Replace `await import(RUNTIME_PKG)` → literal string
      contents = contents.replace(
        /await import\(RUNTIME_PKG\)/g,
        'await import("agent-contracts-runtime")',
      );

      // 3. Replace template-literal adapter imports:
      //    await import(`${runtimePkg}/adapters/mock`)
      //    → await import("agent-contracts-runtime/adapters/mock")
      contents = contents.replace(
        /await import\(`\$\{runtimePkg\}\/adapters\/([^`]+)`\)/g,
        'await import("agent-contracts-runtime/adapters/$1")',
      );

      return { contents, loader: "ts" };
    });
  },
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
      "import { createRequire } from 'module';",
      "const require = createRequire(import.meta.url);",
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
