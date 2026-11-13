#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { createProgram } from "../generated/cli-contract/program.js";
import { handlers } from "./handlers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8"));

const program = createProgram(handlers, pkg.version);
await program.parseAsync();

// The single place the CLI ends the process. Handlers only set process.exitCode.
// Writes to a pipe are asynchronous on macOS, so exiting right after a large write
// truncates the output; wait until stdout and stderr have flushed, then exit
// without waiting for handles that libraries may leave open.
const flushed = (stream: NodeJS.WriteStream): Promise<void> =>
  new Promise((done) => stream.write("", () => done()));
await flushed(process.stdout);
await flushed(process.stderr);
process.exit();
