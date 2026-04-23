/**
 * Generic CSV-based WorkOS user importer
 */

import "dotenv/config";
import { Command } from "commander";
import path from "node:path";
import chalk from "chalk";
import prompts from "prompts";
import { importUsersFromCsv } from "../src/importer.js";
import { renderSummaryBox } from "../src/summary.js";
import { writeErrorsOut } from "../src/errorsOut.js";
import { createLogger } from "../src/logger.js";
import { resolveOrganization } from "../src/orgs.js";
import { CheckpointManager, findLastJob } from "../src/checkpoint/manager.js";
import { calculateCsvHash, countCsvRows, validateCsvHeaders } from "../src/checkpoint/csvUtils.js";
import { parseUserRoleMapping } from "../src/roles/userRoleMappingParser.js";
import { MigrationPlanner } from "../src/orchestrator/migrationPlanner.js";
import { validateConfig } from "../src/orchestrator/configValidator.js";
import { processRoleDefinitions } from "../src/roles/roleDefinitionsProcessor.js";
import { RoleCache } from "../src/roles/roleCache.js";
import { OrganizationCache } from "../src/cache/organizationCache.js";
import type { OrchestratorOptions } from "../src/orchestrator/types.js";

export function registerCommand(parent: Command) {
  parent
    .command('import')
    .description("Generic CSV-based WorkOS user importer")
    .requiredOption("--csv <path>", "Path to CSV file containing users")
    .option("--errors-out <path>", "Write errors to CSV or JSON file")
    .option("--quiet", "Suppress per-record output", false)
    .option("--concurrency <n>", "Max number of parallel requests (default: 10)", (v: string) => parseInt(v, 10))
    .option("--org-id <id>", "Target organization ID for single-org mode")
    .option("--org-external-id <externalId>", "Target organization by external_id for single-org mode")
    .option("--create-org-if-missing", "Create organization if not found (requires --org-external-id and --org-name)", false)
    .option("--org-name <name>", "Organization name when creating via --create-org-if-missing")
    .option("--require-membership", "If membership creation fails, delete newly created user and mark failure", false)
    .option("--dry-run", "Parse and validate only; do not call WorkOS APIs", false)
    // Phase 3: Chunking and resumability
    .option("--job-id <id>", "Job identifier for checkpoint/resume (enables chunked mode)")
    .option("--resume [job-id]", "Resume from checkpoint (auto-detects last job if no ID provided)")
    .option("--chunk-size <n>", "Rows per chunk for checkpointing (default: 1000)", (v: string) => parseInt(v, 10))
    .option("--checkpoint-dir <path>", "Checkpoint storage directory (default: .workos-checkpoints)")
    // Phase 4: Parallel processing
    .option("--workers <n>", "Number of worker threads for parallel processing (default: 1, requires --job-id)", (v: string) => parseInt(v, 10))
    // Role assignment
    .option("--role-mapping <path>", "Path to user-role mapping CSV (external_id → role_slug)")
    .option("--role-definitions <path>", "Path to role definitions CSV (creates roles before import)")
    // Planning and automation
    .option("--plan", "Analyze CSV and display migration plan without importing")
    .option("-y, --yes", "Skip interactive prompts (for scripting/automation)")
    .action(async (opts) => {
      await main(opts);
    });
}

async function main(opts: {
  csv?: string;
  errorsOut?: string;
  quiet?: boolean;
  concurrency?: number;
  orgId?: string;
  orgExternalId?: string;
  createOrgIfMissing?: boolean;
  orgName?: string;
  requireMembership?: boolean;
  dryRun?: boolean;
  // Checkpoint/resume flags
  jobId?: string;
  resume?: string | boolean;
  chunkSize?: number;
  checkpointDir?: string;
  // Parallel processing
  workers?: number;
  // Role assignment
  roleMapping?: string;
  roleDefinitions?: string;
  // Planning and automation
  plan?: boolean;
  yes?: boolean;
}) {
  const csvPath = opts.csv;
  if (!csvPath) {
    // eslint-disable-next-line no-console
    console.error("Error: --csv <path> is required.");
    process.exit(2);
  }
  const absCsv = path.resolve(csvPath);
  const logger = createLogger({ quiet: opts.quiet });

  // Phase 4: Validate worker count
  let numWorkers = opts.workers ?? 1;
  if (numWorkers < 1) {
    // eslint-disable-next-line no-console
    console.error("Error: --workers must be >= 1");
    process.exit(2);
  }
  if (numWorkers > 1 && !opts.jobId && !opts.resume) {
    // eslint-disable-next-line no-console
    console.error("Error: --workers requires --job-id or --resume (checkpoint mode)");
    process.exit(2);
  }
  // Note: We use dynamic import of 'os' module to avoid loading it when not needed
  if (numWorkers > 1) {
    const os = await import('node:os');
    const cpuCount = os.cpus().length;
    if (numWorkers > cpuCount) {
      logger.warn(`Warning: --workers ${numWorkers} exceeds CPU count (${cpuCount})`);
    }
  }

  // Planning mode: analyze CSV and display plan without importing
  if (opts.plan) {
    await runPlanningMode(absCsv, opts);
    process.exit(0); // runPlanningMode exits on its own, but just in case
  }

  // Config validation before execution
  const totalRowsForValidation = await countCsvRows(absCsv);
  const headerInfo = await validateCsvHeaders(absCsv);
  const detectedMode: 'single-org' | 'multi-org' | 'user-only' =
    (opts.orgId || opts.orgExternalId) ? 'single-org' :
    headerInfo.hasOrgColumns ? 'multi-org' : 'user-only';

  const orchestratorOpts: OrchestratorOptions = {
    csvPath: absCsv,
    quiet: opts.quiet,
    yes: opts.yes,
    concurrency: opts.concurrency,
    orgId: opts.orgId,
    orgExternalId: opts.orgExternalId,
    orgName: opts.orgName,
    createOrgIfMissing: opts.createOrgIfMissing,
    requireMembership: opts.requireMembership,
    dryRun: opts.dryRun,
    errorsOutPath: opts.errorsOut,
    jobId: opts.jobId,
    resume: opts.resume,
    chunkSize: opts.chunkSize,
    checkpointDir: opts.checkpointDir,
    workers: opts.workers,
  };

  const validation = validateConfig(orchestratorOpts, detectedMode, totalRowsForValidation);
  if (validation.errors.length > 0) {
    console.error(chalk.red('\nConfiguration errors:'));
    for (const error of validation.errors) {
      console.error(chalk.red(`  - ${error}`));
    }
    process.exit(1);
  }
  if (validation.warnings.length > 0 && !opts.quiet) {
    for (const warning of validation.warnings) {
      logger.warn(`Warning: ${warning}`);
    }
  }

  // Interactive confirmation for large imports
  if (totalRowsForValidation > 10000 && !opts.yes && !opts.quiet && !opts.dryRun) {
    console.log(chalk.yellow(`\nLarge import detected: ${totalRowsForValidation.toLocaleString()} rows`));
    const response = await prompts({
      type: 'confirm',
      name: 'proceed',
      message: 'Proceed with import?',
      initial: true
    });
    if (!response.proceed) {
      console.log(chalk.yellow('Import cancelled'));
      process.exit(0);
    }
  }

  // Checkpoint initialization
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

  // Process role definitions if provided (before import)
  if (opts.roleDefinitions) {
    const definitionsPath = path.resolve(opts.roleDefinitions);
    if (!opts.quiet) {
      console.log(chalk.cyan('\nProcessing role definitions...'));
    }

    const roleCache = new RoleCache({ dryRun: opts.dryRun });
    const orgCache = new OrganizationCache({ dryRun: opts.dryRun });

    const roleSummary = await processRoleDefinitions({
      csvPath: definitionsPath,
      roleCache,
      orgCache,
      dryRun: opts.dryRun,
      quiet: opts.quiet,
    });

    if (!opts.quiet) {
      console.log(`  Created: ${roleSummary.created}, Already exist: ${roleSummary.alreadyExist}, Errors: ${roleSummary.errors}`);
      if (roleSummary.errors > 0) {
        console.log(chalk.yellow('  Warning: Some role definitions failed. Import will continue.'));
      }
      console.log('');
    }
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

    // Parse user-role mapping CSV if provided
    let userRoleMapping: Map<string, string[]> | undefined;
    if (opts.roleMapping) {
      const roleMappingPath = path.resolve(opts.roleMapping);
      const result = await parseUserRoleMapping({ csvPath: roleMappingPath, quiet: opts.quiet });
      userRoleMapping = result.mapping;
      logger.log(`Loaded ${result.totalRows} role assignments for ${result.uniqueUsers} users (${result.uniqueRoles.size} unique roles)`);
      if (result.warnings.length > 0) {
        for (const warning of result.warnings) {
          logger.warn(warning);
        }
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
      checkpointManager, // Phase 3: Enable chunked mode if checkpoint provided
      numWorkers, // Phase 4: Enable worker pool if multiple workers specified
      userRoleMapping // Role assignment mapping
    });

    // Handle CSV error output (legacy, memory-limited)
    if (opts.errorsOut && !useJsonlStreaming && errors.length > 0) {
      await writeErrorsOut(errorsOutPath!, errors);
      logger.warn(`Wrote ${errors.length} error record(s) to: ${errorsOutPath}`);
    } else if (opts.errorsOut && useJsonlStreaming) {
      logger.warn(`Errors streamed to: ${errorsOutPath}`);
    }

    // Only print summary box if not using workers (workers have their own ProgressUI summary)
    if (!numWorkers || numWorkers <= 1) {
      const summaryBox = renderSummaryBox(summary);
      // Print summary to stderr to be visible even when quiet
      // eslint-disable-next-line no-console
      console.error(summaryBox);
    }

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

/**
 * Planning mode: analyze CSV and display migration plan without importing
 */
async function runPlanningMode(
  absCsv: string,
  opts: { quiet?: boolean; concurrency?: number; orgId?: string; orgExternalId?: string; orgName?: string; createOrgIfMissing?: boolean; requireMembership?: boolean; dryRun?: boolean; errorsOut?: string; jobId?: string; resume?: string | boolean; chunkSize?: number; checkpointDir?: string; workers?: number; }
): Promise<void> {
  const options: OrchestratorOptions = {
    csvPath: absCsv,
    quiet: opts.quiet,
    concurrency: opts.concurrency,
    orgId: opts.orgId,
    orgExternalId: opts.orgExternalId,
    orgName: opts.orgName,
    createOrgIfMissing: opts.createOrgIfMissing,
    requireMembership: opts.requireMembership,
    dryRun: opts.dryRun,
    errorsOutPath: opts.errorsOut,
    jobId: opts.jobId,
    resume: opts.resume,
    chunkSize: opts.chunkSize,
    checkpointDir: opts.checkpointDir,
    workers: opts.workers,
  };

  const planner = new MigrationPlanner(options);
  const plan = await planner.generatePlan();

  if (!opts.quiet) {
    console.log(chalk.cyan('\n--- Migration Plan ---\n'));
  }

  console.log(`CSV:              ${plan.summary.csvPath}`);
  console.log(`Total rows:       ${plan.summary.totalRows.toLocaleString()}`);
  console.log(`Mode:             ${plan.summary.mode}`);
  console.log(`Estimated time:   ${plan.summary.estimatedDuration}`);

  if (plan.summary.hasCheckpoint) {
    console.log(`Checkpoint:       Existing checkpoint found`);
  }

  console.log(`\n${chalk.bold('Configuration:')}`);
  console.log(`  Workers:        ${plan.configuration.workers}`);
  console.log(`  Concurrency:    ${plan.configuration.concurrency} per worker`);
  if (plan.summary.estimatedChunks) {
    console.log(`  Chunks:         ${plan.summary.estimatedChunks} (${plan.configuration.chunkSize} rows each)`);
  }
  console.log(`  Org resolution: ${plan.configuration.orgResolution}`);

  if (plan.validation.errors.length > 0) {
    console.log(`\n${chalk.red('Configuration errors:')}`);
    for (const error of plan.validation.errors) {
      console.log(chalk.red(`  - ${error}`));
    }
  }

  if (plan.validation.warnings.length > 0) {
    console.log(`\n${chalk.yellow('Warnings:')}`);
    for (const warning of plan.validation.warnings) {
      console.log(chalk.yellow(`  - ${warning}`));
    }
  }

  if (plan.recommendations.length > 0 && plan.validation.errors.length === 0) {
    console.log(`\n${chalk.bold('Recommendations:')}`);
    for (const recommendation of plan.recommendations) {
      console.log(`  - ${recommendation}`);
    }
  }

  if (plan.valid) {
    console.log(`\n${chalk.green('Plan is valid.')}`);
    console.log(`Ready to import ${plan.summary.totalRows.toLocaleString()} users.`);
    console.log(chalk.gray(`To execute: npx workos-migrate import --csv ${plan.summary.csvPath}`));
    process.exit(0);
  } else {
    console.log(`\n${chalk.red('Plan is invalid.')}`);
    console.log(chalk.gray('Fix the errors above and try again.'));
    process.exit(1);
  }
}
