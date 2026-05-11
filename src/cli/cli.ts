#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { Command } from "commander";
import { resolveCommand } from "./commands/resolve.js";
import { validateCommand } from "./commands/validate.js";
import { lintCommand } from "./commands/lint.js";
import { renderCommand } from "./commands/render.js";
import { checkCommand } from "./commands/check.js";
import { generateCommand } from "./commands/generate.js";
import { scoreCommand } from "./commands/score.js";
import { auditCommand } from "./commands/audit.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8"));

const program = new Command();

program
  .name("agent-contracts")
  .description("Agent contracts tooling — validate, lint, render DSL files")
  .version(pkg.version);

program.addCommand(resolveCommand);
program.addCommand(validateCommand);
program.addCommand(lintCommand);
program.addCommand(renderCommand);
program.addCommand(checkCommand);
program.addCommand(generateCommand);
program.addCommand(scoreCommand);
program.addCommand(auditCommand);

program.parse();
