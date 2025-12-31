#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import path from "node:path";
import { importUsersFromCsv } from "../src/importer.js";
import { renderSummaryBox } from "../src/summary.js";
import { writeErrorsOut } from "../src/errorsOut.js";
import { createLogger } from "../src/logger.js";
import { resolveOrganization } from "../src/orgs.js";
import { CheckpointManager, findLastJob } from "../src/checkpoint/manager.js";
import { calculateCsvHash, countCsvRows } from "../src/checkpoint/csvUtils.js";

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
  // Phase 3: Chunking and resumability
  .option("--job-id <id>", "Job identifier for checkpoint/resume (enables chunked mode)")
  .option("--resume [job-id]", "Resume from checkpoint (auto-detects last job if no ID provided)")
  .option("--chunk-size <n>", "Rows per chunk for checkpointing (default: 1000)", (v) => parseInt(v, 10))
  .option("--checkpoint-dir <path>", "Checkpoint storage directory (default: .workos-checkpoints)")
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
    // Phase 3: Checkpoint/resume flags
    jobId?: string;
    resume?: string | boolean;
    chunkSize?: number;
    checkpointDir?: string;
  }>();

  const csvPath = opts.csv ?? opts.userExport;
  if (!csvPath) {
    // eslint-disable-next-line no-console
    console.error("Error: --csv <path> is required.");
    process.exit(2);
  }
  const absCsv = path.resolve(csvPath);
  const logger = createLogger({ quiet: opts.quiet });

  // Phase 3: Checkpoint initialization
  let checkpointManager: CheckpointManager | undefined;

  // Handle resume mode
  if (opts.resume) {
    const resumeJobId = typeof opts.resume === 'string' ? opts.resume : await findLastJob(opts.checkpointDir);

    if (!resumeJobId) {
      // eslint-disable-next-line no-console
      console.error("Error: No checkpoint found to resume. Use --job-id to start a new job.");
      process.exit(2);
    }

    logger.log(`Resuming job: ${resumeJobId}`);
    checkpointManager = await CheckpointManager.resume(resumeJobId, opts.checkpointDir);

    // Validate CSV hasn't changed
    const state = checkpointManager.getState();
    const currentHash = await calculateCsvHash(absCsv);

    if (currentHash !== state.csvHash) {
      logger.warn("WARNING: CSV file has changed since checkpoint was created!");
      logger.warn("Resuming with a modified CSV may produce unexpected results.");
      // Continue anyway (user can Ctrl+C if they want to abort)
    }

    const progress = checkpointManager.getProgress();
    logger.log(`Checkpoint loaded: ${progress.completedChunks}/${progress.totalChunks} chunks completed (${progress.percentComplete}%)`);
  }
  // Handle new job with checkpointing
  else if (opts.jobId) {
    logger.log("Analyzing CSV file...");
    const totalRows = await countCsvRows(absCsv);
    const csvHash = await calculateCsvHash(absCsv);

    logger.log(`CSV analysis complete: ${totalRows} rows, hash: ${csvHash.substring(0, 16)}...`);

    // Determine mode before creating checkpoint
    const hasSingleOrgFlags = Boolean(opts.orgId || opts.orgExternalId);
    const mode: 'single-org' | 'multi-org' | 'user-only' = hasSingleOrgFlags
      ? 'single-org'
      : 'multi-org'; // Will be refined after org resolution

    checkpointManager = await CheckpointManager.create({
      jobId: opts.jobId,
      csvPath: absCsv,
      csvHash,
      totalRows,
      chunkSize: opts.chunkSize ?? 1000,
      concurrency: opts.concurrency ?? 10,
      mode,
      orgId: null, // Will be set after org resolution
      checkpointDir: opts.checkpointDir
    });

    logger.log(`Checkpoint created: ${checkpointManager.getCheckpointDir()}`);
  }

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
    // Determine import mode
    let resolvedOrgId: string | null = null;
    let multiOrgMode = false;

    // Check for single-org CLI flags
    const hasSingleOrgFlags = Boolean(opts.orgId || opts.orgExternalId);

    if (hasSingleOrgFlags) {
      // Single-org mode via CLI flags (existing behavior)
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
      logger.log(`Single-org mode: Resolved organization ${resolvedOrgId}`);
    } else {
      // Multi-org or user-only mode (determined by CSV content)
      multiOrgMode = true;
      logger.log("Multi-org mode: Organizations will be resolved per-row from CSV");
    }
    // Determine error output path and format
    let errorsOutPath: string | undefined;
    let useJsonlStreaming = false;
    if (opts.errorsOut) {
      errorsOutPath = path.resolve(opts.errorsOut);
      const ext = path.extname(errorsOutPath).toLowerCase();

      // Use JSONL streaming by default, unless explicitly .csv
      if (ext === '.csv') {
        logger.warn('Warning: CSV error output loads all errors into memory. Use .jsonl for large imports.');
        useJsonlStreaming = false;
      } else {
        // Default to JSONL streaming (append .jsonl if no extension)
        if (!ext || ext === '.json') {
          errorsOutPath = errorsOutPath.replace(/\.json$/, '') + '.jsonl';
        }
        useJsonlStreaming = true;
      }
    }

    const { summary, errors } = await importUsersFromCsv({
      csvPath: absCsv,
      quiet: opts.quiet,
      concurrency: opts.concurrency ?? 10,
      orgId: resolvedOrgId,
      requireMembership: Boolean(opts.requireMembership),
      dryRun: Boolean(opts.dryRun),
      errorsOutPath: useJsonlStreaming ? errorsOutPath : undefined,
      multiOrgMode,
      checkpointManager // Phase 3: Enable chunked mode if checkpoint provided
    });

    // Handle CSV error output (legacy, memory-limited)
    if (opts.errorsOut && !useJsonlStreaming && errors.length > 0) {
      await writeErrorsOut(errorsOutPath!, errors);
      logger.warn(`Wrote ${errors.length} error record(s) to: ${errorsOutPath}`);
    } else if (opts.errorsOut && useJsonlStreaming) {
      logger.warn(`Errors streamed to: ${errorsOutPath}`);
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

