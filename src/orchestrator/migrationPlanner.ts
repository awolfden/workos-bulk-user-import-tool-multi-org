/**
 * Phase 5: Import Orchestrator - Migration Planner
 *
 * Generates migration plans with cost estimates and recommendations.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  countCsvRows,
  calculateCsvHash,
  validateCsvHeaders
} from '../checkpoint/csvUtils.js';
import { validateConfig } from './configValidator.js';
import type { OrchestratorOptions, MigrationPlan } from './types.js';

export class MigrationPlanner {
  constructor(private options: OrchestratorOptions) {}

  /**
   * Generate a complete migration plan
   */
  async generatePlan(): Promise<MigrationPlan> {
    // 1. Validate CSV exists and is readable
    if (!fs.existsSync(this.options.csvPath)) {
      return this.errorPlan('CSV file not found');
    }

    try {
      fs.accessSync(this.options.csvPath, fs.constants.R_OK);
    } catch {
      return this.errorPlan('CSV file is not readable');
    }

    // 2. Count rows and calculate hash (parallel)
    let totalRows: number;
    let csvHash: string;

    try {
      [totalRows, csvHash] = await Promise.all([
        countCsvRows(this.options.csvPath),
        calculateCsvHash(this.options.csvPath)
      ]);
    } catch (err) {
      return this.errorPlan(`Failed to analyze CSV: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 3. Detect mode from headers and options
    const mode = await this.detectMode();

    // 4. Check for existing checkpoint
    const hasCheckpoint = await this.checkForCheckpoint(csvHash);

    // 5. Validate configuration
    const validation = validateConfig(this.options, mode, totalRows);

    // 6. Estimate duration (rows / throughput rate)
    const estimatedDuration = this.estimateDuration(totalRows);

    // 7. Calculate estimated chunks
    const estimatedChunks = this.calculateChunks(totalRows);

    // 8. Determine org resolution strategy
    const orgResolution = this.determineOrgResolution(mode);

    // 9. Generate recommendations
    const recommendations = this.generateRecommendations(totalRows, mode);

    // 10. Get configuration values
    const concurrency = this.options.concurrency || 10;
    const workers = this.options.workers || 1;
    const chunkSize = this.options.chunkSize;

    return {
      valid: validation.errors.length === 0,
      summary: {
        csvPath: this.options.csvPath,
        totalRows,
        mode,
        hasCheckpoint,
        estimatedDuration,
        estimatedChunks
      },
      configuration: {
        concurrency,
        workers,
        chunkSize,
        orgResolution
      },
      validation,
      recommendations
    };
  }

  /**
   * Detect import mode from CSV headers and options
   */
  private async detectMode(): Promise<'single-org' | 'multi-org' | 'user-only'> {
    // Single-org mode: org-id or org-external-id flag provided
    if (this.options.orgId || this.options.orgExternalId) {
      return 'single-org';
    }

    // Check CSV headers for org columns
    try {
      const result = await validateCsvHeaders(this.options.csvPath);
      return result.hasOrgColumns ? 'multi-org' : 'user-only';
    } catch {
      // If header validation fails, assume user-only
      return 'user-only';
    }
  }

  /**
   * Check if checkpoint exists for this CSV
   */
  private async checkForCheckpoint(csvHash: string): Promise<boolean> {
    const checkpointDir = this.options.checkpointDir || '.workos-checkpoints';

    // Check if resuming explicit job
    if (this.options.resume && typeof this.options.resume === 'string') {
      const jobDir = path.join(checkpointDir, this.options.resume);
      return fs.existsSync(jobDir);
    }

    // Check if job-id is specified
    if (this.options.jobId) {
      const jobDir = path.join(checkpointDir, this.options.jobId);
      return fs.existsSync(jobDir);
    }

    // No checkpoint configured
    return false;
  }

  /**
   * Estimate import duration based on row count and configuration
   */
  private estimateDuration(totalRows: number): string {
    const workersCount = this.options.workers || 1;
    const concurrency = this.options.concurrency || 10;

    // Base rate: ~20 users/sec at concurrency 10 with 1 worker
    // This is a conservative estimate based on typical network conditions
    const baseRate = 20; // users/sec
    const effectiveRate = baseRate * (concurrency / 10) * workersCount;

    const estimatedSeconds = Math.ceil(totalRows / effectiveRate);

    if (estimatedSeconds < 60) return `~${estimatedSeconds} seconds`;
    if (estimatedSeconds < 3600)
      return `~${Math.ceil(estimatedSeconds / 60)} minutes`;
    return `~${Math.ceil(estimatedSeconds / 3600)} hours`;
  }

  /**
   * Calculate number of chunks for checkpoint mode
   */
  private calculateChunks(totalRows: number): number | undefined {
    if (!this.options.jobId && !this.options.resume) {
      return undefined; // Not using checkpoint mode
    }

    const chunkSize = this.options.chunkSize || 1000;
    return Math.ceil(totalRows / chunkSize);
  }

  /**
   * Determine organization resolution strategy
   */
  private determineOrgResolution(
    mode: 'single-org' | 'multi-org' | 'user-only'
  ): 'upfront' | 'per-row' | 'none' {
    if (mode === 'single-org') {
      return 'upfront'; // Resolve once before import
    } else if (mode === 'multi-org') {
      return 'per-row'; // Resolve per-row with caching
    } else {
      return 'none'; // No org resolution needed
    }
  }

  /**
   * Generate optimization recommendations
   */
  private generateRecommendations(
    totalRows: number,
    mode: 'single-org' | 'multi-org' | 'user-only'
  ): string[] {
    const recommendations: string[] = [];

    // Checkpoint recommendation
    if (totalRows > 10000 && !this.options.jobId && !this.options.resume) {
      recommendations.push(
        `Use --job-id for imports >10K rows to enable resumability`
      );
    }

    // Worker recommendation
    if (totalRows > 50000 && (!this.options.workers || this.options.workers === 1)) {
      const cpus = os.cpus().length;
      const suggested = Math.min(cpus - 1, 4);
      recommendations.push(
        `Use --workers ${suggested} for faster processing (${cpus} CPUs available)`
      );
    }

    // Errors output recommendation
    if (!this.options.errorsOutPath) {
      recommendations.push(
        'Add --errors-out errors.jsonl to capture failures for retry'
      );
    }

    // Multi-org caching info
    if (mode === 'multi-org') {
      recommendations.push(
        'Multi-org mode uses organization caching for performance'
      );
    }

    // Concurrency recommendation for large imports
    if (totalRows > 100000 && (!this.options.concurrency || this.options.concurrency === 10)) {
      recommendations.push(
        'Consider increasing --concurrency for large imports (try 20-50)'
      );
    }

    return recommendations;
  }

  /**
   * Create an error plan (validation failed)
   */
  private errorPlan(error: string): MigrationPlan {
    return {
      valid: false,
      summary: {
        csvPath: this.options.csvPath,
        totalRows: 0,
        mode: 'user-only',
        hasCheckpoint: false,
        estimatedDuration: 'N/A'
      },
      configuration: {
        concurrency: this.options.concurrency || 10,
        workers: this.options.workers || 1,
        orgResolution: 'none'
      },
      validation: {
        errors: [error],
        warnings: []
      },
      recommendations: []
    };
  }
}
