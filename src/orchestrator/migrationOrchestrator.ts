/**
 * Phase 5: Import Orchestrator - Main Orchestrator Class
 *
 * High-level wrapper for migration planning and execution.
 */

import { MigrationPlanner } from './migrationPlanner.js';
import { CheckpointManager } from '../checkpoint/manager.js';
import { importUsersFromCsv } from '../importer.js';
import { resolveOrganization } from '../orgs.js';
import type { OrchestratorOptions, MigrationPlan, MigrationResult } from './types.js';
import type { ImportOptions } from '../types.js';

export class MigrationOrchestrator {
  constructor(private options: OrchestratorOptions) {}

  /**
   * Generate a migration plan (dry-run analysis)
   */
  async plan(): Promise<MigrationPlan> {
    const planner = new MigrationPlanner(this.options);
    return await planner.generatePlan();
  }

  /**
   * Execute the migration (actual import)
   */
  async execute(): Promise<MigrationResult> {
    const startTime = Date.now();

    // 1. Generate plan to validate configuration
    const plan = await this.plan();

    // 2. Check if plan is valid
    if (!plan.valid) {
      throw new Error(
        `Migration plan is invalid:\n  ${plan.validation.errors.join('\n  ')}`
      );
    }

    // 3. Setup checkpoint manager (if checkpoint mode)
    let checkpointManager: CheckpointManager | undefined;

    if (this.options.jobId || this.options.resume) {
      const jobId =
        typeof this.options.resume === 'string'
          ? this.options.resume
          : this.options.jobId || `job-${Date.now()}`;

      if (this.options.resume) {
        // Resume existing checkpoint
        checkpointManager = await CheckpointManager.resume(
          jobId,
          this.options.checkpointDir
        );
      } else {
        // Create new checkpoint
        const csvHash = await import('../checkpoint/csvUtils.js').then(m =>
          m.calculateCsvHash(this.options.csvPath)
        );

        checkpointManager = await CheckpointManager.create({
          jobId,
          csvPath: this.options.csvPath,
          csvHash,
          totalRows: plan.summary.totalRows,
          chunkSize: this.options.chunkSize || 1000,
          concurrency: this.options.concurrency || 10,
          mode: plan.summary.mode,
          orgId: this.options.orgId,
          checkpointDir: this.options.checkpointDir
        });
      }
    }

    // 4. Resolve organization (single-org mode only)
    let resolvedOrgId: string | null = null;

    if (plan.summary.mode === 'single-org') {
      if (this.options.orgId) {
        resolvedOrgId = this.options.orgId;
      } else if (this.options.orgExternalId) {
        try {
          const org = await resolveOrganization(
            undefined,
            this.options.orgExternalId,
            undefined,
            this.options.createOrgIfMissing
          );
          resolvedOrgId = org.id;
        } catch (err) {
          throw new Error(
            `Failed to resolve organization: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      } else if (this.options.orgName) {
        try {
          const org = await resolveOrganization(
            undefined,
            undefined,
            this.options.orgName,
            this.options.createOrgIfMissing
          );
          resolvedOrgId = org.id;
        } catch (err) {
          throw new Error(
            `Failed to resolve organization: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
    }

    // 5. Build import options
    const importOptions: ImportOptions = {
      csvPath: this.options.csvPath,
      quiet: this.options.quiet,
      concurrency: this.options.concurrency,
      orgId: resolvedOrgId,
      requireMembership: this.options.requireMembership,
      dryRun: this.options.dryRun,
      errorsOutPath: this.options.errorsOutPath,
      multiOrgMode: plan.summary.mode === 'multi-org',
      checkpointManager,
      numWorkers: this.options.workers
    };

    // 6. Execute import
    let importResult;
    try {
      importResult = await importUsersFromCsv(importOptions);
    } catch (err) {
      throw new Error(
        `Import failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    // 7. Build result
    const duration = Date.now() - startTime;

    const result: MigrationResult = {
      success: importResult.summary.failures === 0,
      summary: importResult.summary,
      duration,
      errorsPath: this.options.errorsOutPath,
      checkpoint: checkpointManager
        ? {
            jobId: checkpointManager.getJobId(),
            canResume: importResult.summary.failures > 0
          }
        : undefined
    };

    return result;
  }
}
