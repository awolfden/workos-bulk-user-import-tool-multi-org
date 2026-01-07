/**
 * Migration Wizard - Migration Planner
 *
 * Converts user answers into a concrete migration plan with steps.
 */

import path from 'node:path';
import os from 'node:os';
import type { WizardAnswers, MigrationPlan, MigrationStep } from './types.js';

/**
 * Generate a migration plan from wizard answers
 */
export function generateMigrationPlan(answers: WizardAnswers): MigrationPlan {
  const steps: MigrationStep[] = [];
  const warnings: string[] = [];
  const recommendations: string[] = [];

  // Generate job ID once for consistency across all steps
  const jobId = answers.enableCheckpointing ? `migration-${Date.now()}` : undefined;

  // Step 1: Export (if not custom CSV)
  if (answers.source !== 'custom') {
    steps.push(generateExportStep(answers));
  }

  // Step 2: Merge password hashes (if Auth0 and user has passwords)
  if (answers.source === 'auth0' && answers.auth0HasPasswords && answers.auth0PasswordsPath) {
    steps.push(generatePasswordMergeStep(answers));
  }

  // Step 3: Validate CSV (if enabled)
  if (answers.validateCsv) {
    steps.push(generateValidationStep(answers));
  }

  // Step 4: Plan import
  steps.push(generatePlanStep(answers, jobId));

  // Step 5: Execute import
  steps.push(generateImportStep(answers, jobId));

  // Step 6: Analyze errors (conditional)
  steps.push(generateErrorAnalysisStep(answers, jobId));

  // Step 7: Retry failed imports (conditional)
  steps.push(generateRetryStep(answers));

  // Generate warnings
  warnings.push(...generateWarnings(answers));

  // Generate recommendations
  recommendations.push(...generateRecommendations(answers));

  return {
    source: answers.source,
    importMode: answers.importMode,
    steps,
    warnings,
    recommendations
  };
}

/**
 * Generate export step
 */
function generateExportStep(answers: WizardAnswers): MigrationStep {
  const args: string[] = [];

  if (answers.source === 'auth0') {
    args.push('--domain', answers.auth0Domain!);
    args.push('--client-id', answers.auth0ClientId!);
    args.push('--client-secret', answers.auth0ClientSecret!);
    args.push('--output', 'auth0-export.csv');

    if (answers.auth0UseMetadata) {
      args.push('--use-metadata');
    }

    return {
      id: 'export',
      name: 'Export from Auth0',
      description: 'Export users and organizations from Auth0',
      command: 'npx tsx bin/export-auth0.ts',
      args,
      optional: false
    };
  }

  // Future: Okta, Cognito
  throw new Error(`Export not yet supported for ${answers.source}`);
}

/**
 * Generate password merge step
 */
function generatePasswordMergeStep(answers: WizardAnswers): MigrationStep {
  const inputCsv = 'auth0-export.csv';
  const outputCsv = 'auth0-export-with-passwords.csv';

  const args: string[] = [
    '--csv', inputCsv,
    '--passwords', answers.auth0PasswordsPath!,
    '--output', outputCsv
  ];

  return {
    id: 'merge-passwords',
    name: 'Merge Password Hashes',
    description: 'Merge Auth0 password hashes into CSV export',
    command: 'npx tsx bin/merge-auth0-passwords.ts',
    args,
    optional: false
  };
}

/**
 * Generate validation step
 */
function generateValidationStep(answers: WizardAnswers): MigrationStep {
  // Determine input CSV based on source and whether passwords were merged
  let inputCsv: string;
  if (answers.source === 'custom') {
    inputCsv = answers.customCsvPath!;
  } else if (answers.source === 'auth0' && answers.auth0HasPasswords) {
    inputCsv = 'auth0-export-with-passwords.csv';
  } else {
    inputCsv = 'auth0-export.csv';
  }

  const outputCsv = answers.autoFixIssues ? 'users-validated.csv' : undefined;

  const args: string[] = ['--csv', inputCsv];

  if (answers.autoFixIssues) {
    args.push('--auto-fix');
    args.push('--fixed-csv', 'users-validated.csv');
  }

  args.push('--report', 'validation-report.json');

  return {
    id: 'validate',
    name: 'Validate CSV',
    description: 'Validate CSV data and auto-fix common issues',
    command: 'npx tsx bin/validate-csv.ts',
    args,
    optional: false
  };
}

/**
 * Generate plan step
 */
function generatePlanStep(answers: WizardAnswers, jobId?: string): MigrationStep {
  const csvPath = getImportCsvPath(answers);
  const args: string[] = ['--csv', csvPath, '--plan'];

  // Add org configuration
  addOrgArgs(args, answers);

  // Add checkpoint configuration
  if (answers.enableCheckpointing && jobId) {
    args.push('--job-id', jobId);

    if (answers.scale === 'large') {
      args.push('--chunk-size', '5000');
    } else if (answers.scale === 'medium') {
      args.push('--chunk-size', '2000');
    }
  }

  // Add worker configuration
  if (answers.enableWorkers && answers.workerCount) {
    args.push('--workers', answers.workerCount.toString());
  }

  // Add concurrency based on scale
  if (answers.scale === 'large') {
    args.push('--concurrency', '20');
  } else if (answers.scale === 'medium') {
    args.push('--concurrency', '15');
  }

  return {
    id: 'plan',
    name: 'Plan Import',
    description: 'Generate import plan with estimates',
    command: 'npx tsx bin/orchestrate-migration.ts',
    args,
    optional: false
  };
}

/**
 * Generate import step
 */
function generateImportStep(answers: WizardAnswers, jobId?: string): MigrationStep {
  const csvPath = getImportCsvPath(answers);
  const args: string[] = ['--csv', csvPath];

  // Add org configuration
  addOrgArgs(args, answers);

  // Add checkpoint configuration
  if (answers.enableCheckpointing && jobId) {
    args.push('--job-id', jobId);

    if (answers.scale === 'large') {
      args.push('--chunk-size', '5000');
    } else if (answers.scale === 'medium') {
      args.push('--chunk-size', '2000');
    }
  }

  // Add worker configuration
  if (answers.enableWorkers && answers.workerCount) {
    args.push('--workers', answers.workerCount.toString());
  }

  // Add concurrency based on scale
  if (answers.scale === 'large') {
    args.push('--concurrency', '20');
  } else if (answers.scale === 'medium') {
    args.push('--concurrency', '15');
  }

  // Add error logging (only if checkpointing is disabled)
  // When checkpointing is enabled, errors are automatically stored in the checkpoint directory
  if (answers.logErrors && !answers.enableCheckpointing) {
    args.push('--errors-out', answers.errorsPath || 'errors.jsonl');
  }

  return {
    id: 'import',
    name: 'Execute Import',
    description: 'Import users to WorkOS',
    command: 'npx tsx bin/orchestrate-migration.ts',
    args,
    optional: false
  };
}

/**
 * Generate error analysis step
 */
function generateErrorAnalysisStep(answers: WizardAnswers, jobId?: string): MigrationStep {
  // Construct error path based on checkpointing
  let errorsPath = answers.errorsPath || 'errors.jsonl';

  if (answers.enableCheckpointing && jobId) {
    const checkpointDir = answers.checkpointDir || '.workos-checkpoints';
    errorsPath = `${checkpointDir}/${jobId}/errors.jsonl`;
  }

  const args: string[] = [
    '--errors',
    errorsPath,
    '--retry-csv',
    'retry.csv',
    '--report',
    'error-analysis.json'
  ];

  return {
    id: 'analyze-errors',
    name: 'Analyze Errors',
    description: 'Analyze import errors and generate retry CSV',
    command: 'npx tsx bin/analyze-errors.ts',
    args,
    optional: true,
    skipCondition: (ans) => !ans.logErrors
  };
}

/**
 * Generate retry step
 */
function generateRetryStep(answers: WizardAnswers): MigrationStep {
  const args: string[] = ['--csv', 'retry.csv'];

  // Add org configuration
  addOrgArgs(args, answers);

  // Use lower concurrency for retries
  args.push('--concurrency', '5');

  return {
    id: 'retry',
    name: 'Retry Failed Imports',
    description: 'Retry failed imports from error analysis',
    command: 'npx tsx bin/orchestrate-migration.ts',
    args,
    optional: true,
    skipCondition: (ans) => !ans.logErrors
  };
}

/**
 * Add organization arguments to command
 */
function addOrgArgs(args: string[], answers: WizardAnswers): void {
  if (answers.importMode === 'single-org') {
    if (answers.orgId) {
      args.push('--org-id', answers.orgId);
    } else if (answers.orgExternalId) {
      args.push('--org-external-id', answers.orgExternalId);
    } else if (answers.orgName) {
      args.push('--org-name', answers.orgName);
      if (answers.createOrgIfMissing) {
        args.push('--create-org-if-missing');
      }
    }
  }
}

/**
 * Get the CSV path for import step
 */
function getImportCsvPath(answers: WizardAnswers): string {
  if (answers.source === 'custom') {
    return answers.customCsvPath!;
  }

  // If validation with auto-fix was run, use the validated CSV
  if (answers.validateCsv && answers.autoFixIssues) {
    return 'users-validated.csv';
  }

  // If Auth0 passwords were merged, use the merged CSV
  if (answers.source === 'auth0' && answers.auth0HasPasswords) {
    return 'auth0-export-with-passwords.csv';
  }

  return 'auth0-export.csv';
}

/**
 * Generate warnings based on configuration
 */
function generateWarnings(answers: WizardAnswers): string[] {
  const warnings: string[] = [];

  if (!answers.validateCsv) {
    warnings.push('Skipping CSV validation may result in import errors');
  }

  if (!answers.logErrors) {
    warnings.push('Error logging disabled - failed imports cannot be retried');
  }

  if (answers.scale === 'large' && !answers.enableCheckpointing) {
    warnings.push('Large migration without checkpointing - cannot resume if interrupted');
  }

  if (answers.scale === 'large' && !answers.enableWorkers) {
    warnings.push('Large migration without workers - import will take longer');
  }

  if (answers.importMode === 'single-org' && !answers.orgId && !answers.orgExternalId && !answers.orgName) {
    warnings.push('No organization specified for single-org mode');
  }

  return warnings;
}

/**
 * Generate recommendations based on configuration
 */
function generateRecommendations(answers: WizardAnswers): string[] {
  const recommendations: string[] = [];

  if (answers.scale === 'small' && answers.enableWorkers) {
    recommendations.push('Workers may not improve performance for small migrations');
  }

  if (answers.source === 'auth0' && !answers.auth0UseMetadata) {
    recommendations.push('Consider including metadata for complete user profiles');
  }

  if (answers.source === 'auth0' && !answers.auth0HasPasswords) {
    recommendations.push('Users will need to reset passwords on first login (no password hashes provided)');
    recommendations.push('To include passwords: Request password export from Auth0 support');
  }

  if (answers.enableCheckpointing) {
    recommendations.push('Checkpoint directory: .workos-checkpoints/');
    recommendations.push('You can resume this migration with --resume flag');
  }

  if (answers.importMode === 'multi-org') {
    recommendations.push('Multi-org mode uses organization caching for performance');
  }

  return recommendations;
}
