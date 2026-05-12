#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { createProgram } from "../generated/cli-contract/program.js";
import { handlers } from "./handlers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8"));

const program = createProgram(handlers, pkg.version);
program.parse();
