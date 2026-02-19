/**
 * Phase 5: Import Orchestrator - Type Definitions
 *
 * Defines interfaces for migration planning and execution.
 */

import type { ImportSummary } from '../types.js';

/**
 * Options for the orchestrator (superset of import options)
 */
export interface OrchestratorOptions {
  // CSV and basic options
  csvPath: string;
  quiet?: boolean;
  yes?: boolean; // Skip all prompts (for scripting/MCP)

  // Import options (pass-through to importer)
  concurrency?: number;
  orgId?: string | null;
  orgExternalId?: string;
  orgName?: string;
  createOrgIfMissing?: boolean;
  requireMembership?: boolean;
  dryRun?: boolean;
  errorsOutPath?: string;

  // Checkpoint/resumability options
  jobId?: string;
  resume?: boolean | string;
  chunkSize?: number;
  checkpointDir?: string;

  // Worker options
  workers?: number;

  // Role assignment options
  userRoleMapping?: Map<string, string[]>; // external_id → role slugs
}

/**
 * Migration plan generated in planning mode
 */
export interface MigrationPlan {
  valid: boolean;
  summary: {
    csvPath: string;
    totalRows: number;
    mode: 'single-org' | 'multi-org' | 'user-only';
    hasCheckpoint: boolean;
    estimatedDuration: string; // "~5 minutes"
    estimatedChunks?: number;
  };
  configuration: {
    concurrency: number;
    workers: number;
    chunkSize?: number;
    orgResolution: 'upfront' | 'per-row' | 'none';
  };
  validation: {
    errors: string[]; // Blocking issues
    warnings: string[]; // Non-blocking issues
  };
  recommendations: string[]; // Optimization suggestions
}

/**
 * Result from executing a migration
 */
export interface MigrationResult {
  success: boolean;
  summary: ImportSummary; // From importer
  duration: number; // Total time (ms)
  errorsPath?: string;
  checkpoint?: {
    jobId: string;
    canResume: boolean;
  };
}
