import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    cli: "src/cli/cli.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  outDir: "dist",
  sourcemap: true,
  splitting: false,
  noExternal: [
    "@stoplight/spectral-core",
    "@stoplight/spectral-functions",
    "@stoplight/spectral-rulesets",
  ],
  external: [
    "agent-contracts-runtime",
    "@cursor/sdk",
    "@anthropic-ai/claude-agent-sdk",
    "@anthropic-ai/sdk",
    "@openai/agents",
    "@google/adk",
  ],
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
});
