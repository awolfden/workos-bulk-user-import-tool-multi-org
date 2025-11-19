#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import path from "node:path";
import { importUsersFromCsv } from "../src/importer.js";
import { renderSummaryBox } from "../src/summary.js";
import { writeErrorsOut } from "../src/errorsOut.js";
import { createLogger } from "../src/logger.js";
import { resolveOrganization } from "../src/orgs.js";

const program = new Command();

program
  .name("workos-import-users")
  .description("Generic CSV-based WorkOS user importer")
  .requiredOption("--csv <path>", "Path to CSV file containing users")
  .option("--errors-out <path>", "Write errors to CSV or JSON file")
  .option("--quiet", "Suppress per-record output", false)
  .option("--concurrency <n>", "Max number of parallel requests (default: 10)", (v) => parseInt(v, 10))
  .option("--org-id <id>", "Target organization ID for single-org mode")
  .option("--org-external-id <externalId>", "Target organization by external_id for single-org mode")
  .option("--create-org-if-missing", "Create organization if not found (requires --org-external-id and --org-name)", false)
  .option("--org-name <name>", "Organization name when creating via --create-org-if-missing")
  .option("--require-membership", "If membership creation fails, delete newly created user and mark failure", false)
  .option("--dry-run", "Parse and validate only; do not call WorkOS APIs", false)
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
    orgId?: string;
    orgExternalId?: string;
    createOrgIfMissing?: boolean;
    orgName?: string;
    requireMembership?: boolean;
    dryRun?: boolean;
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
    if (opts.orgId && opts.orgExternalId) {
      throw new Error("Provide only one of --org-id or --org-external-id, not both.");
    }
    if (opts.createOrgIfMissing && !opts.orgExternalId) {
      throw new Error("--create-org-if-missing requires --org-external-id");
    }
    if (opts.createOrgIfMissing && (!opts.orgName || String(opts.orgName).trim() === "")) {
      throw new Error("--org-name is required when using --create-org-if-missing");
    }
    let resolvedOrgId: string | null = null;
    if (opts.dryRun) {
      // In dry run, avoid creating organizations; best-effort resolve when possible
      if (opts.orgId) {
        resolvedOrgId = opts.orgId;
      } else if (opts.orgExternalId) {
        try {
          resolvedOrgId = await resolveOrganization({
            orgId: undefined,
            orgExternalId: opts.orgExternalId,
            createIfMissing: false,
            orgName: undefined
          });
          if (!resolvedOrgId && opts.createOrgIfMissing) {
            logger.warn(`Dry run: organization with external_id="${opts.orgExternalId}" not found; would create "${opts.orgName ?? "(no name)"}"`);
          }
        } catch (e: any) {
          logger.warn(`Dry run: org resolution warning: ${e?.message || String(e)}`);
        }
      }
      logger.warn("Dry run enabled: no users or memberships will be created.");
    } else {
      resolvedOrgId = await resolveOrganization({
        orgId: opts.orgId,
        orgExternalId: opts.orgExternalId,
        createIfMissing: opts.createOrgIfMissing,
        orgName: opts.orgName
      });
    }
    const { summary, errors } = await importUsersFromCsv({
      csvPath: absCsv,
      quiet: opts.quiet,
      concurrency: opts.concurrency ?? 10,
      orgId: resolvedOrgId,
      requireMembership: Boolean(opts.requireMembership),
      dryRun: Boolean(opts.dryRun)
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

