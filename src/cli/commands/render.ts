import { Command } from "commander";
import { runGenerate } from "./generate.js";

export const renderCommand = new Command("render")
  .description("(deprecated) Alias for 'generate templates'. Use 'generate templates' instead.")
  .option("-c, --config <path>", "Path to agent-contracts.config.yaml")
  .option("--team <id>", "Limit to one team (multi-team config only)")
  .option("--check", "Check for template drift without writing files", false)
  .option("--quiet", "Suppress output on success", false)
  .action(
    async (opts: { config?: string; team?: string; check: boolean; quiet: boolean }) => {
      process.stderr.write(
        "Warning: 'render' is deprecated. Use 'agent-contracts generate templates' instead.\n",
      );
      await runGenerate("templates", {
        ...opts,
        binding: undefined,
        output: undefined,
        format: "yaml",
        dryRun: false,
      });
    },
  );
