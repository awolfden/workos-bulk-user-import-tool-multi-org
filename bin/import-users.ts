#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import path from "node:path";
import { importUsersFromCsv } from "../src/importer.js";
import { renderSummaryBox } from "../src/summary.js";
import { writeErrorsOut } from "../src/errorsOut.js";
import { createLogger } from "../src/logger.js";

const program = new Command();

program
  .name("workos-import-users")
  .description("Generic CSV-based WorkOS user importer")
  .requiredOption("--csv <path>", "Path to CSV file containing users")
  .option("--errors-out <path>", "Write errors to CSV or JSON file")
  .option("--quiet", "Suppress per-record output", false)
  .option("--concurrency <n>", "Max number of parallel requests (default: 10)", (v) => parseInt(v, 10))
  // Back-compat: accept --user-export as alias to --csv
  .option("--user-export <path>", "(deprecated) Use --csv instead", undefined)
  .parse(process.argv);

async function main() {
  const opts = program.opts<{
    csv?: string;
    userExport?: string;
    errorsOut?: string;
    quiet?: boolean;
    concurrency?: number;
  }>();

  const csvPath = opts.csv ?? opts.userExport;
  if (!csvPath) {
    // eslint-disable-next-line no-console
    console.error("Error: --csv <path> is required.");
    process.exit(2);
  }
  const absCsv = path.resolve(csvPath);
  const logger = createLogger({ quiet: opts.quiet });

  let exitCode = 0;
  try {
    const { summary, errors } = await importUsersFromCsv({
      csvPath: absCsv,
      quiet: opts.quiet,
      concurrency: opts.concurrency ?? 10
    });

    if (opts.errorsOut && errors.length > 0) {
      const outPath = path.resolve(opts.errorsOut);
      await writeErrorsOut(outPath, errors);
      logger.warn(`Wrote ${errors.length} error record(s) to: ${outPath}`);
    }

    const summaryBox = renderSummaryBox(summary);
    // Print summary to stderr to be visible even when quiet
    // eslint-disable-next-line no-console
    console.error(summaryBox);

    if (errors.length > 0) {
      exitCode = 1;
    }
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error(`Fatal error: ${err?.message || String(err)}`);
    exitCode = 1;
  } finally {
    process.exit(exitCode);
  }
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
main();

