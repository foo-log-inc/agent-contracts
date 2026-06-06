import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["test/bundle/**", "**/node_modules/**"],
    globals: false,
    passWithNoTests: true,
  },
});
