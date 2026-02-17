/**
 * Migration Wizard - Step Executor
 *
 * Executes migration steps and tracks results.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import chalk from 'chalk';
import prompts from 'prompts';
import type { MigrationStep, StepResult, WizardAnswers } from './types.js';

/**
 * Execute a migration step
 */
export async function executeStep(
  step: MigrationStep,
  answers: WizardAnswers,
  quiet: boolean = false
): Promise<StepResult> {
  const startTime = Date.now();

  // Check if step should be skipped
  if (step.skipCondition && step.skipCondition(answers)) {
    return {
      stepId: step.id,
      success: true,
      startTime,
      endTime: Date.now(),
      metadata: { skipped: true }
    };
  }

  if (!quiet) {
    console.log(chalk.cyan(`\n${'='.repeat(60)}`));
    console.log(chalk.cyan(step.name));
    console.log(chalk.cyan('='.repeat(60)));
    console.log(chalk.gray(step.description));
    console.log(chalk.gray(`\nRunning: ${step.command} ${step.args.join(' ')}`));
    console.log();
  }

  try {
    const output = await runCommand(step.command, step.args, quiet);
    const endTime = Date.now();

    if (!quiet) {
      console.log(chalk.green(`\n✓ ${step.name} completed\n`));
    }

    // Extract job ID from import step for later use
    const metadata: Record<string, unknown> = {};
    if (step.id === 'import') {
      const jobIdIndex = step.args.findIndex(arg => arg === '--job-id');
      if (jobIdIndex !== -1 && jobIdIndex + 1 < step.args.length) {
        metadata.jobId = step.args[jobIdIndex + 1];
      }
    }

    return {
      stepId: step.id,
      success: true,
      startTime,
      endTime,
      output,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined
    };
  } catch (error) {
    const endTime = Date.now();
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (!quiet) {
      console.log(chalk.red(`\n✗ ${step.name} failed`));
      console.log(chalk.red(`Error: ${errorMessage}\n`));
    }

    return {
      stepId: step.id,
      success: false,
      startTime,
      endTime,
      error: errorMessage
    };
  }
}

/**
 * Run a command and return output
 */
function runCommand(command: string, args: string[], quiet: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    // Parse command (handle npx tsx)
    let cmd: string;
    let cmdArgs: string[];

    if (command.startsWith('npx tsx')) {
      cmd = 'npx';
      const scriptPath = command.replace('npx tsx ', '');
      cmdArgs = ['tsx', scriptPath, ...args];
    } else {
      cmd = command;
      cmdArgs = args;
    }

    const child = spawn(cmd, cmdArgs, {
      stdio: quiet ? 'pipe' : 'inherit',
      shell: true
    });

    let output = '';
    let errorOutput = '';

    if (quiet) {
      child.stdout?.on('data', (data) => {
        output += data.toString();
      });

      child.stderr?.on('data', (data) => {
        errorOutput += data.toString();
      });
    }

    child.on('close', (code) => {
      if (code === 0) {
        resolve(output);
      } else {
        reject(new Error(errorOutput || `Command exited with code ${code}`));
      }
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Execute multiple steps sequentially
 */
export async function executeSteps(
  steps: MigrationStep[],
  answers: WizardAnswers,
  quiet: boolean = false,
  requireConsent: boolean = true
): Promise<StepResult[]> {
  const results: StepResult[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step) {
      continue; // Skip if somehow undefined
    }

    // Check if step should run based on previous results
    if (!shouldRunStep(step, results, answers)) {
      if (!quiet) {
        console.log(chalk.gray(`\nSkipping optional step: ${step.name} (no errors to process)`));
      }
      results.push({
        stepId: step.id,
        success: true,
        startTime: Date.now(),
        endTime: Date.now(),
        metadata: { skipped: true }
      });
      continue;
    }

    if (!quiet) {
      console.log(chalk.cyan(`\nStep ${i + 1}/${steps.length}: ${step.name}`));
    }

    const result = await executeStep(step, answers, quiet);
    results.push(result);

    // Stop on failure for non-optional steps
    if (!result.success && !step.optional) {
      if (!quiet) {
        console.log(chalk.red(`\n✗ Migration stopped due to failure in: ${step.name}`));
      }
      break;
    }

    // For optional steps, continue even if they fail
    if (!result.success && step.optional) {
      if (!quiet) {
        console.log(chalk.yellow(`\n⚠️  Optional step failed: ${step.name}`));
        console.log(chalk.gray('Continuing with remaining steps...'));
      }
    }

    // Ask for user consent before continuing (unless last step or quiet mode)
    if (result.success && requireConsent && i < steps.length - 1 && !quiet) {
      const nextStep = steps[i + 1];
      if (!nextStep) {
        continue; // Skip if next step is undefined
      }
      const hasMoreSteps = i + 2 < steps.length;

      console.log(chalk.gray(`\nNext: ${nextStep.name}`));

      const continueAnswer = await prompts({
        type: 'confirm',
        name: 'continue',
        message: hasMoreSteps ? 'Continue to next step?' : 'Continue to final step?',
        initial: true
      });

      if (!continueAnswer.continue) {
        if (!quiet) {
          console.log(chalk.yellow('\n⚠️  Migration paused by user'));
          console.log(chalk.gray(`Completed ${i + 1}/${steps.length} steps`));
          console.log(chalk.gray('You can resume this migration later if checkpointing is enabled.'));
        }
        break;
      }
    }
  }

  return results;
}

/**
 * Check if a step should run based on previous results
 */
export function shouldRunStep(
  step: MigrationStep,
  previousResults: StepResult[],
  answers: WizardAnswers
): boolean {
  // Check skip condition
  if (step.skipCondition && step.skipCondition(answers)) {
    return false;
  }

  // Special logic for conditional steps
  if (step.id === 'analyze-errors') {
    // Only run if import step completed AND errors file exists with content
    const importResult = previousResults.find(r => r.stepId === 'import');
    if (!importResult) {
      return false;
    }

    // Check if errors file exists
    let errorsPath = answers.errorsPath || 'errors.jsonl';

    // If checkpointing was enabled, construct checkpoint-aware path
    if (answers.enableCheckpointing) {
      const importStep = previousResults.find(r => r.stepId === 'import');
      if (importStep && importStep.metadata?.jobId) {
        const checkpointDir = answers.checkpointDir || '.workos-checkpoints';
        errorsPath = `${checkpointDir}/${importStep.metadata.jobId}/errors.jsonl`;
      }
    }

    // Check if errors file exists AND has content
    if (!fs.existsSync(errorsPath)) {
      return false;
    }

    // Check if file has actual content (not just empty or whitespace)
    try {
      const stats = fs.statSync(errorsPath);
      if (stats.size === 0) {
        return false; // Empty file
      }

      // Read first few bytes to check if there's actual JSON content
      const content = fs.readFileSync(errorsPath, 'utf-8').trim();
      return content.length > 0; // Has non-whitespace content
    } catch {
      return false; // Error reading file
    }
  }

  if (step.id === 'retry') {
    // Only run if error analysis completed successfully
    const analyzeResult = previousResults.find(r => r.stepId === 'analyze-errors');
    if (!analyzeResult || !analyzeResult.success) {
      return false;
    }

    // Check if retry CSV was generated AND has content
    if (!fs.existsSync('retry.csv')) {
      return false;
    }

    // Check if file has actual content (more than just header row)
    try {
      const stats = fs.statSync('retry.csv');
      if (stats.size === 0) {
        return false; // Empty file
      }

      // Read file and check if it has more than just the header line
      const content = fs.readFileSync('retry.csv', 'utf-8').trim();
      const lines = content.split('\n').filter(line => line.trim().length > 0);
      return lines.length > 1; // Has header + at least one data row
    } catch {
      return false; // Error reading file
    }
  }

  return true;
}
