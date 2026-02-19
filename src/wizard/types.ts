/**
 * Migration Wizard - Type Definitions
 *
 * Types for the guided migration wizard.
 */

/**
 * Migration source provider
 */
export type MigrationSource = 'auth0' | 'okta' | 'cognito' | 'clerk' | 'custom';

/**
 * Import mode
 */
export type ImportMode = 'single-org' | 'multi-org';

/**
 * Organization specification method
 */
export type OrgSpecMethod = 'org-id' | 'org-external-id' | 'org-name';

/**
 * Scale category for migration size
 */
export type ScaleCategory = 'small' | 'medium' | 'large';

/**
 * User's answers to wizard questions
 */
export interface WizardAnswers {
  // Source configuration
  source: MigrationSource;
  customCsvPath?: string;

  // Import mode
  importMode: ImportMode;

  // Organization configuration (single-org only)
  orgSpecMethod?: OrgSpecMethod;
  orgId?: string;
  orgExternalId?: string;
  orgName?: string;
  createOrgIfMissing?: boolean;

  // Scale and performance
  scale: ScaleCategory;
  enableCheckpointing: boolean;
  enableWorkers?: boolean;
  workerCount?: number;
  checkpointDir?: string;

  // Validation
  validateCsv: boolean;
  autoFixIssues?: boolean;

  // Error handling
  logErrors: boolean;
  errorsPath?: string;

  // Dry run
  runDryRunFirst?: boolean;

  // Provider credentials (Auth0)
  auth0Domain?: string;
  auth0ClientId?: string;
  auth0ClientSecret?: string;
  auth0PlanTier?: 'free' | 'developer' | 'trial' | 'enterprise'; // Deprecated - kept for backward compatibility
  auth0IncludeOrgs?: boolean; // Whether to include organizations in export
  auth0OrgMethod?: 'api' | 'metadata'; // Organization discovery method
  auth0UseMetadata?: boolean; // Deprecated - use auth0OrgMethod instead
  auth0RateLimit?: number; // Rate limit in requests per second
  auth0HasPasswords?: boolean;
  auth0PasswordsPath?: string;

  // Provider configuration (Clerk)
  clerkCsvPath?: string;
  clerkOrgMappingPath?: string;

  // Role mapping (universal — applies to all sources)
  hasRoleMapping?: boolean;
  hasRoleDefinitions?: boolean;
  roleDefinitionsPath?: string;
  roleMappingPath?: string;

  // Advanced options
  concurrency?: number;
  chunkSize?: number;
  dryRun?: boolean;
}

/**
 * Migration step in the workflow
 */
export interface MigrationStep {
  id: string;
  name: string;
  description: string;
  command: string;
  args: string[];
  optional: boolean;
  skipCondition?: (answers: WizardAnswers) => boolean;
  estimatedDuration?: string;
}

/**
 * Complete migration plan
 */
export interface MigrationPlan {
  source: MigrationSource;
  importMode: ImportMode;
  estimatedUserCount?: number;
  steps: MigrationStep[];
  warnings: string[];
  recommendations: string[];
}

/**
 * Step execution result
 */
export interface StepResult {
  stepId: string;
  success: boolean;
  startTime: number;
  endTime: number;
  output?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Complete migration result
 */
export interface MigrationResult {
  success: boolean;
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
  skippedSteps: number;
  stepResults: StepResult[];
  totalDuration: number;
  summary: {
    totalUsers?: number;
    successfulUsers?: number;
    failedUsers?: number;
    retries?: number;
  };
}

/**
 * Wizard options from CLI flags
 */
export interface WizardOptions {
  dryRun?: boolean;
  yes?: boolean;
  resume?: boolean;
  quiet?: boolean;
  source?: MigrationSource;
  orgId?: string;
  auth0Domain?: string;
}

/**
 * Credential configuration
 */
export interface CredentialConfig {
  type: 'auth0' | 'okta' | 'cognito';
  domain?: string;
  clientId?: string;
  clientSecret?: string;
  region?: string;
  apiKey?: string;
}

/**
 * Environment check result
 */
export interface EnvironmentCheck {
  passed: boolean;
  checks: {
    name: string;
    passed: boolean;
    message?: string;
  }[];
}
