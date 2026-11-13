import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Dsl } from "../../schema/index.js";
import { generateInterface } from "../../interface-generator/index.js";

export interface RunGenerateInterfaceCliOptions {
  dsl: Dsl;
  output?: string;
  dryRun: boolean;
  format: "yaml" | "json";
  quiet: boolean;
}

export function runGenerateInterfaceCli(opts: RunGenerateInterfaceCliOptions): void {
  const outputPath = resolve(process.cwd(), opts.output ?? "team-interface.yaml");
  const result = generateInterface({
    dsl: opts.dsl,
    output: outputPath,
    dryRun: opts.dryRun,
    format: opts.format,
  });

  if (opts.dryRun) {
    process.stdout.write(result.content);
    return;
  }

  writeFileSync(result.outputPath, result.content, "utf8");

  if (!opts.quiet) {
    process.stdout.write(`Wrote ${result.outputPath}\n`);
  }
}
