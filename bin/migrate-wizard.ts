/**
 * Migration Wizard
 *
 * Interactive guided migration from Auth0/Okta/Cognito to WorkOS.
 */

import 'dotenv/config';
import { Command } from 'commander';
import chalk from 'chalk';
import prompts from 'prompts';
import { askQuestions } from '../src/wizard/questionFlow.js';
import { generateMigrationPlan } from '../src/wizard/migrationPlanner.js';
import { executeSteps } from '../src/wizard/stepExecutor.js';
import {
  checkEnvironment,
  displayEnvironmentCheck,
  saveAuth0Credentials
} from '../src/wizard/credentialManager.js';
import {
  displayMigrationPlan,
  displayMigrationSummary,
  generateMigrationResult,
  saveMigrationSummary
} from '../src/wizard/summaryReporter.js';
import type { WizardOptions } from '../src/wizard/types.js';
import { ensureOutputDir, outputPath } from '../src/outputDir.js';

export function registerCommand(parent: Command) {
  parent
    .command('wizard')
    .description('Interactive guided migration wizard for WorkOS User Management')
    .version('1.0.0')
    // Options
    .option('-y, --yes', 'Skip confirmation prompts')
    .option('--quiet', 'Suppress progress output')
    .option('--no-validate', 'Skip CSV validation step')
    .option('--no-auto-fix', 'Skip auto-fix during validation')
    .option('--no-error-log', 'Disable error logging to file')
    // Pre-filled options (for non-interactive use)
    .option('--source <provider>', 'Migration source (auth0, okta, cognito, custom)')
    .option('--org-id <id>', 'WorkOS organization ID')
    .option('--auth0-domain <domain>', 'Auth0 domain')
    .action(async (opts) => {
      await main(opts);
    });
}

/**
 * Main function
 */
async function main(opts: Record<string, any>) {
  try {
    // Step 1: Check environment
    console.log(chalk.cyan.bold('WorkOS Migration Wizard'));
    console.log(chalk.gray('Version 1.0.0\n'));

    ensureOutputDir();

    const envCheck = checkEnvironment();
    displayEnvironmentCheck(envCheck);

    if (!envCheck.passed) {
      process.exit(2);
    }

    // Step 2: Ask questions
    const wizardOptions: WizardOptions = {
      yes: opts.yes,
      quiet: opts.quiet,
      source: opts.source,
      orgId: opts.orgId,
      auth0Domain: opts.auth0Domain,
      noValidate: opts.validate === false,
      noAutoFix: opts.autoFix === false,
      noErrorLog: opts.errorLog === false,
    };

    const answers = await askQuestions(wizardOptions);

    // Step 3: Save credentials (if Auth0)
    if (answers.source === 'auth0') {
      saveAuth0Credentials(answers);
    }

    // Step 4: Generate migration plan
    const plan = generateMigrationPlan(answers);
    displayMigrationPlan(plan);

    // Step 5: Confirm execution (unless --yes)
    if (!opts.yes) {
      const confirmation = await prompts({
        type: 'confirm',
        name: 'proceed',
        message: 'Ready to start the migration?',
        initial: true
      });

      if (!confirmation.proceed) {
        console.log(chalk.yellow('\nMigration cancelled\n'));
        process.exit(0);
      }
    }

    // Step 6: Execute migration steps
    console.log(chalk.cyan('\n' + '='.repeat(60)));
    console.log(chalk.cyan('EXECUTING MIGRATION'));
    console.log(chalk.cyan('='.repeat(60)));

    const stepResults = await executeSteps(plan.steps, answers, opts.quiet);

    // Step 7: Generate and display summary
    const result = generateMigrationResult(stepResults, plan);
    displayMigrationSummary(result);

    // Step 8: Save summary to file
    saveMigrationSummary(result, plan);

    // Step 9: Handle errors if any
    if (!result.success) {
      console.log(chalk.yellow('\n⚠️  Migration completed with errors\n'));

      // Check if errors.jsonl exists
      const hasErrors = stepResults.some(r => r.stepId === 'import' && !r.success);

      if (hasErrors && answers.logErrors) {
        // Construct correct error path (checkpointed or not)
        let errorsPath = answers.errorsPath || outputPath('errors.jsonl');
        let jobId: string | undefined;

        // If checkpointing was enabled, extract job ID from import step
        if (answers.enableCheckpointing) {
          const importStep = plan.steps.find(s => s.id === 'import');
          if (importStep) {
            const jobIdArg = importStep.args.find((arg, i) =>
              importStep.args[i - 1] === '--job-id'
            );
            if (jobIdArg) {
              jobId = jobIdArg;
              const checkpointDir = answers.checkpointDir || '.workos-checkpoints';
              errorsPath = `${checkpointDir}/${jobIdArg}/errors.jsonl`;
            }
          }
        }

        console.log(chalk.bold('Next steps:'));
        console.log(chalk.gray(`  1. Review errors: cat ${errorsPath}`));
        console.log(chalk.gray(`  2. Analyze errors: npx workos-migrate analyze --errors ${errorsPath}`));
        console.log(chalk.gray('  3. Fix issues and retry\n'));

        // Display retry commands
        console.log(chalk.bold('Retry Commands:\n'));

        // Build CSV path for retry
        const csvPath = answers.customCsvPath ||
                        (answers.source === 'auth0' ? outputPath('auth0-export.csv') : 'users.csv');

        if (jobId) {
          // Checkpoint mode - resume from checkpoint
          console.log(chalk.cyan('  # Resume from checkpoint (retries failed records):'));
          let resumeCmd = `  npx workos-migrate import --csv ${csvPath} --resume ${jobId}`;

          // Add org configuration if in single-org mode
          if (answers.importMode === 'single-org') {
            if (answers.orgId) {
              resumeCmd += ` --org-id ${answers.orgId}`;
            } else if (answers.orgExternalId) {
              resumeCmd += ` --org-external-id ${answers.orgExternalId}`;
              if (answers.orgName) {
                resumeCmd += ` --org-name "${answers.orgName}"`;
              }
              if (answers.createOrgIfMissing) {
                resumeCmd += ' --create-org-if-missing';
              }
            }
          }

          // Add workers if parallel mode was enabled
          if (answers.enableCheckpointing && answers.enableWorkers && answers.workerCount) {
            resumeCmd += ` --workers ${answers.workerCount}`;
          }

          console.log(chalk.white(resumeCmd));
        } else {
          // Non-checkpoint mode - retry from scratch
          console.log(chalk.cyan('  # Retry import (full re-run):'));
          let retryCmd = `  npx workos-migrate import --csv ${csvPath}`;

          // Add org configuration if in single-org mode
          if (answers.importMode === 'single-org') {
            if (answers.orgId) {
              retryCmd += ` --org-id ${answers.orgId}`;
            } else if (answers.orgExternalId) {
              retryCmd += ` --org-external-id ${answers.orgExternalId}`;
              if (answers.orgName) {
                retryCmd += ` --org-name "${answers.orgName}"`;
              }
              if (answers.createOrgIfMissing) {
                retryCmd += ' --create-org-if-missing';
              }
            }
          } else {
            // Multi-org mode
            retryCmd += ' --multi-org-mode';
          }

          // Add concurrency
          if (answers.concurrency) {
            retryCmd += ` --concurrency ${answers.concurrency}`;
          }

          console.log(chalk.white(retryCmd));
        }

        console.log(chalk.gray('\n  Note: Fix data issues in your CSV before retrying if errors are validation-related.\n'));
      }

      process.exit(1);
    } else {
      console.log(chalk.green('✓ All users successfully migrated!\n'));
      process.exit(0);
    }

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

