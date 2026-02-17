/**
 * Phase 5: Import Orchestrator - Configuration Validator
 *
 * Validates orchestrator options before execution.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { OrchestratorOptions } from './types.js';

export interface ValidationResult {
  errors: string[];
  warnings: string[];
}

/**
 * Validates orchestrator configuration
 */
export function validateConfig(
  options: OrchestratorOptions,
  mode: 'single-org' | 'multi-org' | 'user-only',
  totalRows: number
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Validate CSV file exists and is readable
  if (!fs.existsSync(options.csvPath)) {
    errors.push(`CSV file not found: ${options.csvPath}`);
  } else {
    try {
      fs.accessSync(options.csvPath, fs.constants.R_OK);
    } catch {
      errors.push(`CSV file is not readable: ${options.csvPath}`);
    }
  }

  // 2. Validate org-related options
  if (mode === 'single-org') {
    // Single-org mode requires at least one org identifier
    if (!options.orgId && !options.orgExternalId && !options.orgName) {
      errors.push(
        'Single-org mode requires --org-id, --org-external-id, or --org-name'
      );
    }

    // Mutual exclusivity: org-id vs org-external-id
    if (options.orgId && options.orgExternalId) {
      errors.push(
        'Cannot specify both --org-id and --org-external-id (choose one)'
      );
    }
  } else if (mode === 'multi-org') {
    // Multi-org mode should not have single-org flags
    if (options.orgId || options.orgExternalId) {
      warnings.push(
        'Multi-org mode detected (CSV has org columns). --org-id and --org-external-id flags will be ignored.'
      );
    }
  } else if (mode === 'user-only') {
    // User-only mode should not have org flags
    if (options.orgId || options.orgExternalId || options.orgName) {
      warnings.push(
        'User-only mode detected (no org columns). Org flags will be ignored.'
      );
    }
  }

  // 3. Validate checkpoint-related options
  if (options.workers && options.workers > 1) {
    // Workers require checkpoint mode
    if (!options.jobId && !options.resume) {
      errors.push(
        'Worker mode (--workers > 1) requires checkpoint mode (--job-id or --resume)'
      );
    }

    // Workers must be >= 1
    if (options.workers < 1) {
      errors.push('--workers must be >= 1');
    }
  }

  // 4. Validate resume option
  if (options.resume) {
    if (typeof options.resume === 'string') {
      // Resuming with explicit job ID
      const checkpointDir = options.checkpointDir || '.workos-checkpoints';
      const jobDir = path.join(checkpointDir, options.resume);
      if (!fs.existsSync(jobDir)) {
        errors.push(`Checkpoint not found for job: ${options.resume}`);
      }
    } else if (options.resume === true && !options.jobId) {
      errors.push('--resume requires --job-id to specify which job to resume');
    }
  }

  // 5. Validate checkpoint directory (if specified)
  if (options.checkpointDir) {
    const checkpointDir = options.checkpointDir;
    if (fs.existsSync(checkpointDir)) {
      try {
        fs.accessSync(checkpointDir, fs.constants.W_OK);
      } catch {
        errors.push(`Checkpoint directory is not writable: ${checkpointDir}`);
      }
    } else {
      // Directory doesn't exist - will be created, check parent is writable
      const parentDir = path.dirname(checkpointDir);
      if (!fs.existsSync(parentDir)) {
        errors.push(`Parent directory does not exist: ${parentDir}`);
      } else {
        try {
          fs.accessSync(parentDir, fs.constants.W_OK);
        } catch {
          errors.push(
            `Cannot create checkpoint directory (parent not writable): ${parentDir}`
          );
        }
      }
    }
  }

  // 6. Validate concurrency
  if (options.concurrency !== undefined && options.concurrency < 1) {
    errors.push('--concurrency must be >= 1');
  }

  // 7. Validate chunk size
  if (options.chunkSize !== undefined && options.chunkSize < 100) {
    warnings.push('--chunk-size < 100 may result in excessive checkpointing');
  }

  // 8. Validate large imports without checkpointing
  if (totalRows > 10000 && !options.jobId && !options.resume) {
    warnings.push(
      `Large import (${totalRows.toLocaleString()} rows) without checkpoint mode. Consider using --job-id for resumability.`
    );
  }

  // 9. Validate errors output path (if specified)
  if (options.errorsOutPath) {
    const errorsDir = path.dirname(options.errorsOutPath);
    if (!fs.existsSync(errorsDir)) {
      errors.push(`Errors output directory does not exist: ${errorsDir}`);
    } else {
      try {
        fs.accessSync(errorsDir, fs.constants.W_OK);
      } catch {
        errors.push(`Errors output directory is not writable: ${errorsDir}`);
      }
    }
  }

  return { errors, warnings };
}
