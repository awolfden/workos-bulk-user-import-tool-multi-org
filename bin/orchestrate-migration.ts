#!/usr/bin/env node
/**
 * Phase 5: Import Orchestrator - CLI Entry Point
 *
 * High-level migration workflow with planning and interactive validation.
 *
 * Exit codes:
 * - 0: Success (plan valid OR import completed)
 * - 1: Failure (plan invalid OR import failed)
 * - 2: Fatal error (file not found, invalid options)
 */

import 'dotenv/config';
import { Command } from 'commander';
import chalk from 'chalk';
import path from 'node:path';
import prompts from 'prompts';
import { MigrationOrchestrator } from '../src/orchestrator/migrationOrchestrator.js';
import type { OrchestratorOptions } from '../src/orchestrator/types.js';
import { parseUserRoleMapping } from '../src/roles/userRoleMappingParser.js';
import { processRoleDefinitions } from '../src/roles/roleDefinitionsProcessor.js';
import { RoleCache } from '../src/roles/roleCache.js';
import { OrganizationCache } from '../src/cache/organizationCache.js';

const program = new Command();

program
  .name('orchestrate-migration')
  .description('Plan and execute WorkOS user migrations with interactive guidance')
  .version('1.0.0')
  // Required options
  .requiredOption('--csv <path>', 'Path to CSV file')
  // Planning and execution options
  .option('--plan', 'Generate migration plan only (dry-run analysis)')
  .option('-y, --yes', 'Skip all interactive prompts (for scripting/MCP)')
  // Organization options (single-org mode)
  .option('--org-id <id>', 'WorkOS organization ID (single-org mode)')
  .option('--org-external-id <id>', 'Organization external ID (single-org mode)')
  .option('--org-name <name>', 'Organization name (single-org mode, creates if missing with --create-org-if-missing)')
  .option('--create-org-if-missing', 'Create organization if not found (requires --org-name)')
  // Import behavior options
  .option('--concurrency <number>', 'Concurrent API requests', parseInt)
  .option('--require-membership', 'Require organization membership for all users')
  .option('--dry-run', 'Validate CSV without making API calls')
  .option('--quiet', 'Suppress progress output')
  .option('--errors-out <path>', 'Output path for errors.jsonl')
  // Checkpoint options
  .option('--job-id <id>', 'Job ID for checkpoint mode')
  .option('--resume [id]', 'Resume from checkpoint (optionally specify job ID)')
  .option('--chunk-size <number>', 'Rows per checkpoint chunk', parseInt)
  .option('--checkpoint-dir <path>', 'Checkpoint directory (default: .workos-checkpoints)')
  // Worker options
  .option('--workers <number>', 'Number of worker processes (requires checkpoint mode)', parseInt)
  // Role options
  .option('--role-definitions <path>', 'Path to role definitions CSV (creates roles before import)')
  .option('--role-mapping <path>', 'Path to user-role mapping CSV (external_id → role_slug)')
  .parse(process.argv);

const opts = program.opts();

/**
 * Main function
 */
async function main() {
  try {
    // Build orchestrator options from CLI flags
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

    // Parse user-role mapping CSV if provided
    let userRoleMapping: Map<string, string[]> | undefined;
    if (opts.roleMapping) {
      const roleMappingPath = path.resolve(opts.roleMapping);
      const result = await parseUserRoleMapping({ csvPath: roleMappingPath, quiet: opts.quiet });
      userRoleMapping = result.mapping;
      if (!opts.quiet) {
        console.log(`Loaded ${result.totalRows} role assignments for ${result.uniqueUsers} users (${result.uniqueRoles.size} unique roles)`);
        if (result.warnings.length > 0) {
          for (const warning of result.warnings) {
            console.log(chalk.yellow(`  Warning: ${warning}`));
          }
        }
        console.log('');
      }
    }

    const options: OrchestratorOptions = {
      csvPath: opts.csv,
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
      userRoleMapping
    };

    const orchestrator = new MigrationOrchestrator(options);

    // PLANNING MODE
    if (opts.plan) {
      await runPlanningMode(orchestrator, options);
      return;
    }

    // EXECUTION MODE
    await runExecutionMode(orchestrator, options);

  } catch (err) {
    console.error(chalk.red('\n❌ Fatal error:'));
    console.error(err instanceof Error ? err.message : String(err));

    if (err instanceof Error && err.stack && !opts.quiet) {
      console.error('\nStack trace:');
      console.error(chalk.gray(err.stack));
    }

    process.exit(2);
  }
}

/**
 * Run planning mode (--plan flag)
 */
async function runPlanningMode(
  orchestrator: MigrationOrchestrator,
  options: OrchestratorOptions
): Promise<void> {
  if (!options.quiet) {
    console.log(chalk.cyan('\n╔════════════════════════════════════════════════════╗'));
    console.log(chalk.cyan('║              MIGRATION PLAN                        ║'));
    console.log(chalk.cyan('╚════════════════════════════════════════════════════╝\n'));
  }

  const plan = await orchestrator.plan();

  // Display summary
  console.log(`CSV:              ${plan.summary.csvPath}`);
  console.log(`Total rows:       ${plan.summary.totalRows.toLocaleString()}`);
  console.log(`Mode:             ${plan.summary.mode}`);
  console.log(`Estimated time:   ${plan.summary.estimatedDuration}`);

  if (plan.summary.hasCheckpoint) {
    console.log(`Checkpoint:       Existing checkpoint found`);
  }

  // Display configuration
  console.log(`\n${chalk.bold('Configuration:')}`);
  console.log(`  Workers:        ${plan.configuration.workers}`);
  console.log(`  Concurrency:    ${plan.configuration.concurrency} per worker`);
  if (plan.summary.estimatedChunks) {
    console.log(`  Chunks:         ${plan.summary.estimatedChunks} (${plan.configuration.chunkSize} rows each)`);
  }
  console.log(`  Org resolution: ${plan.configuration.orgResolution}`);

  // Display validation errors
  if (plan.validation.errors.length > 0) {
    console.log(`\n${chalk.red('❌ Configuration errors:')}`);
    for (const error of plan.validation.errors) {
      console.log(chalk.red(`  • ${error}`));
    }
  }

  // Display validation warnings
  if (plan.validation.warnings.length > 0) {
    console.log(`\n${chalk.yellow('⚠️  Warnings:')}`);
    for (const warning of plan.validation.warnings) {
      console.log(chalk.yellow(`  • ${warning}`));
    }
  }

  // Display recommendations
  if (plan.recommendations.length > 0 && plan.validation.errors.length === 0) {
    console.log(`\n${chalk.bold('Recommendations:')}`);
    for (const recommendation of plan.recommendations) {
      console.log(`  • ${recommendation}`);
    }
  }

  // Exit based on plan validity
  if (plan.valid) {
    console.log(`\n${chalk.green('✓ Plan is valid')}`);
    console.log(`\nReady to import ${plan.summary.totalRows.toLocaleString()} users`);
    console.log(chalk.gray(`To execute: npx tsx bin/orchestrate-migration.ts --csv ${plan.summary.csvPath}`));
    process.exit(0);
  } else {
    console.log(`\n${chalk.red('✗ Plan is invalid')}`);
    console.log(chalk.gray('Fix the errors above and try again.'));
    process.exit(1);
  }
}

/**
 * Run execution mode (default)
 */
async function runExecutionMode(
  orchestrator: MigrationOrchestrator,
  options: OrchestratorOptions
): Promise<void> {
  // Generate plan first
  const plan = await orchestrator.plan();

  if (!options.quiet) {
    console.log(chalk.cyan('\n╔════════════════════════════════════════════════════╗'));
    console.log(chalk.cyan('║           IMPORT ORCHESTRATOR                      ║'));
    console.log(chalk.cyan('╚════════════════════════════════════════════════════╝\n'));
    console.log(`CSV:        ${plan.summary.csvPath}`);
    console.log(`Total rows: ${plan.summary.totalRows.toLocaleString()}`);
    console.log(`Mode:       ${plan.summary.mode}`);
    console.log(`Workers:    ${plan.configuration.workers}`);
    console.log('');
  }

  // Interactive prompt for missing org-id (unless --yes)
  if (
    plan.summary.mode === 'single-org' &&
    !options.orgId &&
    !options.orgExternalId &&
    !options.orgName &&
    !options.yes
  ) {
    console.log(chalk.yellow('⚠️  Single-org mode requires an organization identifier'));
    const response = await prompts({
      type: 'text',
      name: 'orgId',
      message: 'Enter organization ID:',
      validate: (value: string) => value.trim().length > 0 || 'Organization ID is required'
    });

    if (!response.orgId) {
      console.log(chalk.yellow('Import cancelled'));
      process.exit(0);
    }

    options.orgId = response.orgId;
  }

  // Confirmation for large imports (unless --yes or --quiet or --dry-run)
  if (plan.summary.totalRows > 10000 && !options.yes && !options.quiet && !options.dryRun) {
    console.log(chalk.yellow(`⚠️  Large import detected: ${plan.summary.totalRows.toLocaleString()} rows`));
    console.log(`Estimated duration: ${plan.summary.estimatedDuration}`);
    console.log('');

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

  // Execute import
  if (!options.quiet) {
    console.log(chalk.gray('Starting import...\n'));
  }

  const result = await orchestrator.execute();

  // Display results
  if (!options.quiet) {
    console.log(chalk.cyan('\n╔════════════════════════════════════════════════════╗'));
    console.log(chalk.cyan('║            IMPORT COMPLETE                         ║'));
    console.log(chalk.cyan('╚════════════════════════════════════════════════════╝\n'));

    console.log(`Total:       ${result.summary.total.toLocaleString()}`);
    console.log(`Successes:   ${chalk.green(result.summary.successes.toLocaleString())} (${((result.summary.successes / result.summary.total) * 100).toFixed(1)}%)`);
    console.log(`Failures:    ${result.summary.failures > 0 ? chalk.red(result.summary.failures.toLocaleString()) : result.summary.failures} (${((result.summary.failures / result.summary.total) * 100).toFixed(1)}%)`);
    console.log(`Duration:    ${formatDuration(result.duration)}`);

    // Display next steps if there were failures
    if (result.summary.failures > 0) {
      console.log(`\n${chalk.yellow('⚠️  Some imports failed')}`);
      console.log('\nNext steps:');
      if (result.errorsPath) {
        console.log(chalk.gray(`  1. Review errors: cat ${result.errorsPath}`));
        console.log(chalk.gray(`  2. Analyze errors: npx tsx bin/analyze-errors.ts --errors ${result.errorsPath}`));
        console.log(chalk.gray('  3. Fix issues and retry\n'));
      }

      // Display retry commands
      console.log(chalk.bold('Retry Commands:\n'));

      if (result.checkpoint) {
        // Checkpoint mode - show resume command
        console.log(chalk.cyan('  # Resume from checkpoint (retries failed records):'));
        let resumeCmd = `  npx tsx bin/orchestrate-migration.ts --csv ${options.csvPath} --resume ${result.checkpoint.jobId}`;

        // Add org configuration
        if (options.orgId) {
          resumeCmd += ` --org-id ${options.orgId}`;
        } else if (options.orgExternalId) {
          resumeCmd += ` --org-external-id ${options.orgExternalId}`;
          if (options.orgName) {
            resumeCmd += ` --org-name "${options.orgName}"`;
          }
          if (options.createOrgIfMissing) {
            resumeCmd += ' --create-org-if-missing';
          }
        }

        // Add workers if parallel mode
        if (options.workers && options.workers > 1) {
          resumeCmd += ` --workers ${options.workers}`;
        }

        console.log(chalk.white(resumeCmd));
        console.log('');
      } else {
        // Non-checkpoint mode - show full retry
        console.log(chalk.cyan('  # Retry import (full re-run):'));
        let retryCmd = `  npx tsx bin/import-users.ts --csv ${options.csvPath}`;

        // Add org configuration
        if (options.orgId) {
          retryCmd += ` --org-id ${options.orgId}`;
        } else if (options.orgExternalId) {
          retryCmd += ` --org-external-id ${options.orgExternalId}`;
          if (options.orgName) {
            retryCmd += ` --org-name "${options.orgName}"`;
          }
          if (options.createOrgIfMissing) {
            retryCmd += ' --create-org-if-missing';
          }
        }

        // Add concurrency
        if (options.concurrency) {
          retryCmd += ` --concurrency ${options.concurrency}`;
        }

        console.log(chalk.white(retryCmd));
        console.log('');
      }

      console.log(chalk.gray('  Note: Fix data issues in your CSV before retrying if errors are validation-related.'));
      console.log('');
    } else {
      console.log(`\n${chalk.green('✓ Import completed successfully')}`);
    }
  }

  // Exit based on success
  process.exit(result.success ? 0 : 1);
}

/**
 * Format duration in milliseconds to human-readable string
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

// Run main function
main();
