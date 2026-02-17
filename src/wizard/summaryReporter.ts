/**
 * Migration Wizard - Summary Reporter
 *
 * Generates and displays migration summary.
 */

import fs from 'node:fs';
import chalk from 'chalk';
import type { MigrationResult, StepResult, MigrationPlan } from './types.js';

/**
 * Generate migration result from step results
 */
export function generateMigrationResult(
  stepResults: StepResult[],
  plan: MigrationPlan
): MigrationResult {
  const totalSteps = stepResults.length;
  const completedSteps = stepResults.filter(r => r.success).length;
  const failedSteps = stepResults.filter(r => !r.success && !r.metadata?.skipped).length;
  const skippedSteps = stepResults.filter(r => r.metadata?.skipped).length;

  const startTime = stepResults[0]?.startTime || Date.now();
  const endTime = stepResults[stepResults.length - 1]?.endTime || Date.now();
  const totalDuration = endTime - startTime;

  // Try to extract user counts from output
  const summary = extractUserCounts(stepResults);

  return {
    success: failedSteps === 0,
    totalSteps,
    completedSteps,
    failedSteps,
    skippedSteps,
    stepResults,
    totalDuration,
    summary
  };
}

/**
 * Extract user counts from step outputs
 */
function extractUserCounts(stepResults: StepResult[]): MigrationResult['summary'] {
  const summary: MigrationResult['summary'] = {};

  // Look for import step output
  const importResult = stepResults.find(r => r.stepId === 'import');
  if (importResult?.output) {
    // Try to parse numbers from output
    const successMatch = importResult.output.match(/Successes:\s+(\d+)/i);
    const failureMatch = importResult.output.match(/Failures:\s+(\d+)/i);
    const totalMatch = importResult.output.match(/Total:\s+(\d+)/i);

    if (totalMatch?.[1]) summary.totalUsers = parseInt(totalMatch[1]);
    if (successMatch?.[1]) summary.successfulUsers = parseInt(successMatch[1]);
    if (failureMatch?.[1]) summary.failedUsers = parseInt(failureMatch[1]);
  }

  // Look for retry step
  const retryResult = stepResults.find(r => r.stepId === 'retry');
  if (retryResult && retryResult.success) {
    summary.retries = 1;
  }

  return summary;
}

/**
 * Display migration summary
 */
export function displayMigrationSummary(result: MigrationResult): void {
  console.log(chalk.cyan('\n' + '='.repeat(60)));
  console.log(chalk.cyan('MIGRATION COMPLETE'));
  console.log(chalk.cyan('='.repeat(60) + '\n'));

  // Overall status
  if (result.success) {
    console.log(chalk.green('✓ Migration completed successfully!\n'));
  } else {
    console.log(chalk.red('✗ Migration completed with errors\n'));
  }

  // Step summary
  console.log(chalk.bold('Steps:'));
  console.log(`  Total:     ${result.totalSteps}`);
  console.log(`  Completed: ${chalk.green(result.completedSteps.toString())}`);
  console.log(`  Failed:    ${result.failedSteps > 0 ? chalk.red(result.failedSteps.toString()) : result.failedSteps}`);
  console.log(`  Skipped:   ${result.skippedSteps}`);

  // User summary (if available)
  if (result.summary.totalUsers !== undefined) {
    console.log(chalk.bold('\nUsers:'));
    console.log(`  Total:     ${result.summary.totalUsers.toLocaleString()}`);
    console.log(`  Success:   ${chalk.green((result.summary.successfulUsers || 0).toLocaleString())}`);
    console.log(`  Failed:    ${(result.summary.failedUsers || 0) > 0 ? chalk.red((result.summary.failedUsers || 0).toLocaleString()) : (result.summary.failedUsers || 0)}`);

    if (result.summary.retries) {
      console.log(`  Retries:   ${result.summary.retries}`);
    }
  }

  // Duration
  const durationSeconds = Math.floor(result.totalDuration / 1000);
  const minutes = Math.floor(durationSeconds / 60);
  const seconds = durationSeconds % 60;
  const durationStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

  console.log(chalk.bold('\nDuration:'));
  console.log(`  ${durationStr}`);

  // Failed steps details
  if (result.failedSteps > 0) {
    console.log(chalk.bold('\nFailed Steps:'));
    result.stepResults
      .filter(r => !r.success && !r.metadata?.skipped)
      .forEach(r => {
        console.log(chalk.red(`  ✗ ${r.stepId}`));
        if (r.error) {
          console.log(chalk.gray(`    ${r.error}`));
        }
      });
  }

  // Next steps
  console.log(chalk.bold('\nGenerated Files:'));
  const files = [
    'auth0-export.csv',
    'users-validated.csv',
    'validation-report.json',
    'errors.jsonl',
    'error-analysis.json',
    'retry.csv',
    'migration-summary.json'
  ].filter(f => fs.existsSync(f));

  files.forEach(f => {
    console.log(chalk.gray(`  • ${f}`));
  });

  console.log();
}

/**
 * Save migration summary to JSON file
 */
export function saveMigrationSummary(
  result: MigrationResult,
  plan: MigrationPlan,
  outputPath: string = 'migration-summary.json'
): void {
  const summary = {
    timestamp: new Date().toISOString(),
    source: plan.source,
    importMode: plan.importMode,
    result: {
      success: result.success,
      totalSteps: result.totalSteps,
      completedSteps: result.completedSteps,
      failedSteps: result.failedSteps,
      skippedSteps: result.skippedSteps,
      totalDuration: result.totalDuration,
      summary: result.summary
    },
    steps: result.stepResults.map(r => ({
      stepId: r.stepId,
      success: r.success,
      duration: r.endTime - r.startTime,
      skipped: r.metadata?.skipped || false,
      error: r.error
    })),
    plan: {
      warnings: plan.warnings,
      recommendations: plan.recommendations
    }
  };

  fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2), 'utf-8');
  console.log(chalk.gray(`Migration summary saved to: ${outputPath}\n`));
}

/**
 * Display migration plan before execution
 */
export function displayMigrationPlan(plan: MigrationPlan): void {
  console.log(chalk.cyan('\n' + '='.repeat(60)));
  console.log(chalk.cyan('MIGRATION PLAN'));
  console.log(chalk.cyan('='.repeat(60) + '\n'));

  console.log(chalk.bold('Source:      ') + plan.source);
  console.log(chalk.bold('Import Mode: ') + plan.importMode);
  console.log();

  console.log(chalk.bold('Your migration will follow these steps:\n'));

  plan.steps.forEach((step, index) => {
    console.log(chalk.bold(`${index + 1}. ${step.name}`));
    console.log(chalk.gray(`   ${step.description}`));
    if (step.optional) {
      console.log(chalk.yellow('   (optional - will only run if needed)'));
    }
    console.log(chalk.gray(`   Command: ${step.command} ${step.args.join(' ')}`));
    console.log();
  });

  // Warnings
  if (plan.warnings.length > 0) {
    console.log(chalk.yellow('⚠️  Warnings:'));
    plan.warnings.forEach(w => {
      console.log(chalk.yellow(`  • ${w}`));
    });
    console.log();
  }

  // Recommendations
  if (plan.recommendations.length > 0) {
    console.log(chalk.bold('💡 Recommendations:'));
    plan.recommendations.forEach(r => {
      console.log(chalk.gray(`  • ${r}`));
    });
    console.log();
  }

  console.log(chalk.cyan('='.repeat(60) + '\n'));
}
