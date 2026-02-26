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

  // Step 1: Export (if not custom CSV, Clerk, or Firebase — those provide their own export)
  if (answers.source !== 'custom' && answers.source !== 'clerk' && answers.source !== 'firebase') {
    steps.push(generateExportStep(answers));
  }

  // Step 1.5: Transform Clerk export (if Clerk source)
  if (answers.source === 'clerk') {
    steps.push(generateClerkTransformStep(answers));
  }

  // Step 1.5: Transform Firebase export (if Firebase source)
  if (answers.source === 'firebase') {
    steps.push(generateFirebaseTransformStep(answers));
  }

  // Step 2: Merge password hashes (if Auth0 and user has passwords)
  if (answers.source === 'auth0' && answers.auth0HasPasswords && answers.auth0PasswordsPath) {
    steps.push(generatePasswordMergeStep(answers));
  }

  // Step 2.5: Process role definitions (if provided)
  if (answers.hasRoleDefinitions && answers.roleDefinitionsPath) {
    steps.push(generateRoleDefinitionsStep(answers));
  }

  // Step 3: Validate CSV (if enabled)
  if (answers.validateCsv) {
    steps.push(generateValidationStep(answers));
  }

  // Step 4: Plan import
  steps.push(generatePlanStep(answers, jobId));

  // Step 5: Dry-run import (if enabled)
  if (answers.runDryRunFirst) {
    steps.push(generateDryRunStep(answers, jobId));
  }

  // Step 6: Execute import
  steps.push(generateImportStep(answers, jobId));

  // Step 7: Analyze errors (conditional)
  steps.push(generateErrorAnalysisStep(answers, jobId));

  // Step 8: Retry failed imports (conditional)
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

    // Add organization flags if organizations are included
    if (answers.auth0IncludeOrgs !== false) {
      // Use new auth0OrgMethod field, fallback to deprecated auth0UseMetadata
      const useMetadata = answers.auth0OrgMethod === 'metadata' || answers.auth0UseMetadata;
      if (useMetadata) {
        args.push('--use-metadata');
      }
    }

    if (answers.auth0RateLimit) {
      args.push('--rate-limit', String(answers.auth0RateLimit));
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
 * Generate role definitions processing step
 */
function generateRoleDefinitionsStep(answers: WizardAnswers): MigrationStep {
  const args: string[] = [
    '--definitions', answers.roleDefinitionsPath!,
    '--report', 'role-definitions-report.json',
  ];

  // Add org mapping for resolving org_external_id in role definitions
  if (answers.clerkOrgMappingPath) {
    args.push('--org-mapping', answers.clerkOrgMappingPath);
  } else if (answers.firebaseOrgMappingPath) {
    args.push('--org-mapping', answers.firebaseOrgMappingPath);
  }

  return {
    id: 'process-role-definitions',
    name: 'Process Role Definitions',
    description: 'Create roles and permissions in WorkOS from definitions CSV',
    command: 'npx tsx bin/process-role-definitions.ts',
    args,
    optional: false,
  };
}

/**
 * Generate Clerk transform step
 */
function generateClerkTransformStep(answers: WizardAnswers): MigrationStep {
  const args: string[] = [
    '--clerk-csv', answers.clerkCsvPath!,
    '--output', 'clerk-transformed.csv',
  ];

  if (answers.clerkOrgMappingPath) {
    args.push('--org-mapping', answers.clerkOrgMappingPath);
  }

  // Add role mapping for Clerk transform (merges role_slugs into output CSV)
  if (answers.roleMappingPath && answers.source === 'clerk') {
    args.push('--role-mapping', answers.roleMappingPath);
  }

  return {
    id: 'clerk-transform',
    name: 'Transform Clerk Export',
    description: 'Transform Clerk CSV to WorkOS format (field mapping, passwords, metadata, roles)',
    command: 'npx tsx bin/transform-clerk.ts',
    args,
    optional: false
  };
}

/**
 * Generate Firebase transform step
 */
function generateFirebaseTransformStep(answers: WizardAnswers): MigrationStep {
  const args: string[] = [
    '--firebase-json', answers.firebaseJsonPath!,
    '--output', 'firebase-transformed.csv',
    '--name-split', answers.firebaseNameSplit || 'first-space',
  ];

  // Add scrypt params if provided
  if (answers.firebaseSignerKey) {
    args.push('--signer-key', answers.firebaseSignerKey);
    if (answers.firebaseSaltSeparator) {
      args.push('--salt-separator', answers.firebaseSaltSeparator);
    }
    if (answers.firebaseRounds) {
      args.push('--rounds', String(answers.firebaseRounds));
    }
    if (answers.firebaseMemCost) {
      args.push('--mem-cost', String(answers.firebaseMemCost));
    }
  }

  // Include disabled users
  if (answers.firebaseIncludeDisabled) {
    args.push('--include-disabled');
  }

  // Org mapping
  if (answers.firebaseOrgMappingPath) {
    args.push('--org-mapping', answers.firebaseOrgMappingPath);
  }

  // Role mapping for Firebase transform (merges role_slugs into output CSV)
  if (answers.roleMappingPath && answers.source === 'firebase') {
    args.push('--role-mapping', answers.roleMappingPath);
  }

  return {
    id: 'firebase-transform',
    name: 'Transform Firebase Export',
    description: 'Transform Firebase JSON to WorkOS format (field mapping, passwords, metadata, roles)',
    command: 'npx tsx bin/transform-firebase.ts',
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
  } else if (answers.source === 'clerk') {
    inputCsv = 'clerk-transformed.csv';
  } else if (answers.source === 'firebase') {
    inputCsv = 'firebase-transformed.csv';
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

  // Add role mapping for non-Clerk/Firebase sources (they embed roles in transformed CSV)
  if (answers.roleMappingPath && answers.source !== 'clerk' && answers.source !== 'firebase') {
    args.push('--role-mapping', answers.roleMappingPath);
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
 * Generate dry-run import step
 */
function generateDryRunStep(answers: WizardAnswers, jobId?: string): MigrationStep {
  const csvPath = getImportCsvPath(answers);
  const args: string[] = ['--csv', csvPath, '--dry-run'];

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

  // Add role mapping for non-Clerk/Firebase sources (they embed roles in transformed CSV)
  if (answers.roleMappingPath && answers.source !== 'clerk' && answers.source !== 'firebase') {
    args.push('--role-mapping', answers.roleMappingPath);
  }

  return {
    id: 'dry-run',
    name: 'Test Import (Dry Run)',
    description: 'Validate import configuration without creating users',
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

  // Add role mapping for non-Clerk/Firebase sources (they embed roles in transformed CSV)
  if (answers.roleMappingPath && answers.source !== 'clerk' && answers.source !== 'firebase') {
    args.push('--role-mapping', answers.roleMappingPath);
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

  // If Clerk, use the transformed CSV
  if (answers.source === 'clerk') {
    return 'clerk-transformed.csv';
  }

  // If Firebase, use the transformed CSV
  if (answers.source === 'firebase') {
    return 'firebase-transformed.csv';
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

  if (answers.source === 'clerk' && !answers.clerkOrgMappingPath && answers.importMode !== 'user-only') {
    warnings.push('No org mapping file provided - users will be imported without organization memberships');
  }

  if (answers.source === 'firebase' && !answers.firebaseOrgMappingPath && answers.importMode !== 'user-only') {
    warnings.push('No org mapping file provided - users will be imported without organization memberships');
  }

  if (answers.source === 'firebase' && !answers.firebaseSignerKey) {
    warnings.push('No Firebase scrypt parameters provided - passwords will not be migrated');
  }

  if (answers.hasRoleMapping && !answers.hasRoleDefinitions) {
    warnings.push('User-role mapping provided without role definitions — roles must already exist in WorkOS');
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

  if (answers.source === 'auth0' && answers.auth0OrgMethod === 'api') {
    recommendations.push('Organizations API selected - ensure your Auth0 plan supports this feature');
  }

  if (answers.source === 'auth0' && !answers.auth0HasPasswords) {
    recommendations.push('Users will need to reset passwords on first login (no password hashes provided)');
    recommendations.push('To include passwords: Request password export from Auth0 support');
  }

  if (answers.enableCheckpointing) {
    recommendations.push('Checkpoint directory: .workos-checkpoints/');
    recommendations.push('You can resume this migration with --resume flag');
  }

  if (answers.source === 'clerk') {
    recommendations.push('Clerk passwords (bcrypt) will be migrated - users keep their existing passwords');
    if (answers.clerkOrgMappingPath) {
      recommendations.push('Organization mapping will be applied during transformation');
      recommendations.push('Organizations referenced by org_name will be auto-created in WorkOS if they do not already exist');
      recommendations.push('The import uses organization caching and pre-warming to efficiently handle org creation');
    }
  }

  if (answers.source === 'firebase') {
    if (answers.firebaseSignerKey) {
      recommendations.push('Firebase passwords (scrypt) will be migrated in PHC format - users keep their existing passwords');
    } else {
      recommendations.push('Users will need to reset passwords on first login (no scrypt parameters provided)');
      recommendations.push('To include passwords: Get hash parameters from Firebase Console > Authentication > Users > Password Hash Parameters');
    }
    if (answers.firebaseOrgMappingPath) {
      recommendations.push('Organization mapping will be applied during transformation');
      recommendations.push('Organizations referenced by org_name will be auto-created in WorkOS if they do not already exist');
    }
  }

  if (answers.importMode === 'multi-org') {
    recommendations.push('Multi-org mode uses organization caching for performance');
  }

  if (answers.hasRoleMapping) {
    recommendations.push('Role assignments will be applied during membership creation');
    if (answers.hasRoleDefinitions) {
      recommendations.push('Roles will be created before import — existing roles with different permissions will be preserved with a warning');
    }
  }

  return recommendations;
}
