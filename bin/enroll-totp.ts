#!/usr/bin/env node
/**
 * Enroll TOTP Authentication Factors for Migrated Users
 *
 * After importing users into WorkOS, use this tool to enroll TOTP
 * factors using secrets exported from the previous auth provider.
 *
 * Supports two input formats:
 *
 * 1. CSV with columns: email, totp_secret (required), totp_issuer, totp_user (optional)
 *    npx tsx bin/enroll-totp.ts --input totp-secrets.csv
 *
 * 2. NDJSON with fields: email, totp_secret/secret, or mfa_factors[].secret
 *    npx tsx bin/enroll-totp.ts --input auth0-mfa-export.ndjson --format ndjson
 *
 * TOTP secrets must be Base32-encoded and compatible with:
 *   - Algorithm: SHA1
 *   - Code length: 6 digits
 *   - Timestep: 30 seconds
 *
 * Requires WORKOS_SECRET_KEY environment variable.
 */
import "dotenv/config";
import { Command } from "commander";
import path from "node:path";
import chalk from "chalk";
import { enrollTotpFactors, TotpEnrollSummary } from "../src/totpEnroller.js";

function renderTotpSummaryBox(summary: TotpEnrollSummary): string {
  const supportsColor = process.stderr.isTTY && !process.env.NO_COLOR && !process.env.CI;

  function formatDuration(ms: number): string {
    const seconds = ms / 1000;
    if (seconds < 1) return `${ms.toFixed(0)} ms`;
    return `${seconds.toFixed(1)} s`;
  }

  const duration = formatDuration(summary.endedAt - summary.startedAt);
  const hasFailures = summary.failures > 0;
  const hasEnrolled = summary.enrolled > 0;

  let status: string;
  if (!hasFailures && hasEnrolled) {
    status = "Success";
  } else if (hasFailures && hasEnrolled) {
    status = "Completed with errors";
  } else {
    status = "Failed";
  }

  let statusLine = `Status: ${status}`;
  if (supportsColor) {
    if (status === "Success") {
      statusLine = `Status: ${chalk.green("✓ " + status)}`;
    } else if (status === "Completed with errors") {
      statusLine = `Status: ${chalk.yellow("⚠ " + status)}`;
    } else {
      statusLine = `Status: ${chalk.red("✗ " + status)}`;
    }
  }

  const content = [
    supportsColor ? chalk.bold("TOTP ENROLLMENT SUMMARY") : "TOTP ENROLLMENT SUMMARY",
    statusLine,
    `Total records: ${summary.total}`,
    `Enrolled: ${supportsColor ? chalk.green(summary.enrolled.toString()) : summary.enrolled}`,
    `Skipped (already enrolled): ${summary.skipped}`,
    `User not found: ${supportsColor && summary.userNotFound > 0 ? chalk.yellow(summary.userNotFound.toString()) : summary.userNotFound}`,
    `Failures: ${supportsColor && summary.failures > 0 ? chalk.red(summary.failures.toString()) : summary.failures}`,
    `Duration: ${supportsColor ? chalk.magenta(duration) : duration}`,
  ];

  if (summary.warnings.length > 0) {
    content.push(`Warnings: ${summary.warnings.length}`);
  }

  const stripAnsi = (str: string) => str.replace(/\x1b\[[0-9;]*m/g, "");
  const maxLen = content.reduce((m, s) => Math.max(m, stripAnsi(s).length), 0);
  const horizontal = "═".repeat(maxLen + 2);
  const top = `┌${horizontal}┐`;
  const bottom = `└${horizontal}┘`;
  const body = content.map((line) => {
    const stripped = stripAnsi(line);
    const padding = " ".repeat(maxLen - stripped.length);
    return `│ ${line}${padding} │`;
  });

  return [top, ...body, bottom].join("\n");
}

const program = new Command();

program
  .name("workos-enroll-totp")
  .description(
    "Enroll TOTP authentication factors for WorkOS users using exported secrets"
  )
  .requiredOption(
    "--input <path>",
    "Path to CSV or NDJSON file with email and totp_secret columns"
  )
  .option(
    "--format <format>",
    "Input file format: csv or ndjson (default: auto-detect from extension)",
    undefined
  )
  .option("--errors-out <path>", "Write errors to JSONL file")
  .option("--quiet", "Suppress per-record output", false)
  .option(
    "--concurrency <n>",
    "Max parallel requests (default: 10)",
    (v) => parseInt(v, 10)
  )
  .option("--dry-run", "Look up users but do not enroll factors", false)
  .option(
    "--totp-issuer <name>",
    "Issuer name shown in authenticator apps (defaults to WorkOS team name)"
  )
  .parse(process.argv);

async function main() {
  const opts = program.opts<{
    input: string;
    format?: string;
    errorsOut?: string;
    quiet?: boolean;
    concurrency?: number;
    dryRun?: boolean;
    totpIssuer?: string;
  }>();

  const inputPath = path.resolve(opts.input);

  // Auto-detect format from extension
  let format: "csv" | "ndjson" = "csv";
  if (opts.format) {
    if (opts.format !== "csv" && opts.format !== "ndjson") {
      console.error("Error: --format must be csv or ndjson");
      process.exit(2);
    }
    format = opts.format;
  } else {
    const ext = path.extname(inputPath).toLowerCase();
    if (ext === ".ndjson" || ext === ".jsonl") {
      format = "ndjson";
    }
  }

  let errorsOutPath: string | undefined;
  if (opts.errorsOut) {
    errorsOutPath = path.resolve(opts.errorsOut);
    const ext = path.extname(errorsOutPath).toLowerCase();
    if (!ext || ext === ".json") {
      errorsOutPath = errorsOutPath.replace(/\.json$/, "") + ".jsonl";
    }
  }

  if (!opts.quiet) {
    console.log("WorkOS TOTP Enrollment Tool");
    console.log("===========================\n");
    console.log(`Input: ${inputPath} (${format})`);
    if (opts.dryRun) console.log("[DRY RUN] No factors will be enrolled\n");
  }

  const { summary, errors } = await enrollTotpFactors({
    inputPath,
    format,
    quiet: opts.quiet,
    concurrency: opts.concurrency ?? 10,
    dryRun: Boolean(opts.dryRun),
    errorsOutPath,
    totpIssuer: opts.totpIssuer,
  });

  if (errorsOutPath) {
    console.error(`Errors written to: ${errorsOutPath}`);
  }

  const summaryBox = renderTotpSummaryBox(summary);
  console.error(summaryBox);

  if (summary.warnings.length > 0) {
    for (const w of summary.warnings) {
      console.error(`Warning: ${w}`);
    }
  }

  process.exit(summary.failures > 0 || errors.length > 0 ? 1 : 0);
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
main().catch((err) => {
  console.error(`Fatal error: ${err?.message || String(err)}`);
  process.exit(1);
});
