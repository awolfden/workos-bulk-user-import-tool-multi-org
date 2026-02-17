/**
 * Export Checkpoint Manager
 * Manages checkpoint state for resumable Auth0 exports
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type {
  ExportCheckpointState,
  OrganizationProgress,
  ExportSummary,
  ResumeOptions
} from './types.js';
import type { Auth0Credentials } from '../types.js';

export class ExportCheckpointManager {
  private state: ExportCheckpointState;
  private checkpointPath: string;
  private checkpointDir: string;

  private constructor(
    jobId: string,
    state: ExportCheckpointState,
    checkpointDir?: string
  ) {
    this.state = state;
    this.checkpointDir = checkpointDir || '.workos-checkpoints';
    this.checkpointPath = path.join(this.checkpointDir, jobId, 'export-checkpoint.json');
  }

  /**
   * Create a new checkpoint for an export job
   */
  static async create(
    jobId: string,
    csvPath: string,
    credentials: Auth0Credentials,
    organizations: Array<{ id: string; name: string }>,
    options: {
      useMetadata?: boolean;
      organizationFilter?: string[];
      checkpointDir?: string;
    } = {}
  ): Promise<ExportCheckpointManager> {
    const checkpointDir = options.checkpointDir || '.workos-checkpoints';
    const jobDir = path.join(checkpointDir, jobId);

    // Create checkpoint directory
    await fs.promises.mkdir(jobDir, { recursive: true });

    // Hash credentials for validation (don't store plaintext)
    const credentialsHash = ExportCheckpointManager.hashCredentials(credentials);

    // Initialize organization progress
    const orgProgress: OrganizationProgress[] = organizations.map(org => ({
      orgId: org.id,
      orgName: org.name,
      status: 'pending',
      usersExported: 0,
      usersSkipped: 0
    }));

    // Create initial state
    const state: ExportCheckpointState = {
      jobId,
      csvPath,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      config: {
        domain: credentials.domain,
        credentialsHash,
        useMetadata: options.useMetadata || false,
        organizationFilter: options.organizationFilter
      },
      organizations: orgProgress,
      summary: {
        totalOrgs: organizations.length,
        completedOrgs: 0,
        failedOrgs: 0,
        totalUsers: 0,
        skippedUsers: 0,
        warnings: []
      },
      status: 'in_progress'
    };

    const manager = new ExportCheckpointManager(jobId, state, checkpointDir);
    await manager.saveCheckpoint();

    return manager;
  }

  /**
   * Resume from an existing checkpoint
   */
  static async resume(
    options: ResumeOptions,
    credentials: Auth0Credentials
  ): Promise<ExportCheckpointManager> {
    const checkpointDir = options.checkpointDir || '.workos-checkpoints';
    const checkpointPath = path.join(checkpointDir, options.jobId, 'export-checkpoint.json');

    // Check if checkpoint exists
    if (!fs.existsSync(checkpointPath)) {
      throw new Error(`Checkpoint not found: ${checkpointPath}`);
    }

    // Load checkpoint state
    const data = await fs.promises.readFile(checkpointPath, 'utf8');
    const state: ExportCheckpointState = JSON.parse(data);

    // Validate credentials match
    const credentialsHash = ExportCheckpointManager.hashCredentials(credentials);
    if (state.config.credentialsHash !== credentialsHash) {
      throw new Error(
        'Credentials do not match checkpoint. Cannot resume with different Auth0 credentials.'
      );
    }

    // Validate domain matches
    if (state.config.domain !== credentials.domain) {
      throw new Error(
        `Domain mismatch: checkpoint is for ${state.config.domain}, but credentials are for ${credentials.domain}`
      );
    }

    return new ExportCheckpointManager(options.jobId, state, checkpointDir);
  }

  /**
   * Check if a checkpoint exists for a job ID
   */
  static exists(jobId: string, checkpointDir?: string): boolean {
    const dir = checkpointDir || '.workos-checkpoints';
    const checkpointPath = path.join(dir, jobId, 'export-checkpoint.json');
    return fs.existsSync(checkpointPath);
  }

  /**
   * Hash credentials for validation (don't store plaintext)
   */
  private static hashCredentials(credentials: Auth0Credentials): string {
    const data = `${credentials.domain}:${credentials.clientId}:${credentials.clientSecret}`;
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * Get pending organizations (not yet completed)
   */
  getPendingOrganizations(): OrganizationProgress[] {
    return this.state.organizations.filter(
      org => org.status === 'pending' || org.status === 'in_progress'
    );
  }

  /**
   * Get completed organizations
   */
  getCompletedOrganizations(): OrganizationProgress[] {
    return this.state.organizations.filter(org => org.status === 'completed');
  }

  /**
   * Get failed organizations
   */
  getFailedOrganizations(): OrganizationProgress[] {
    return this.state.organizations.filter(org => org.status === 'failed');
  }

  /**
   * Mark organization as in progress
   */
  async startOrganization(orgId: string): Promise<void> {
    const org = this.state.organizations.find(o => o.orgId === orgId);
    if (!org) {
      throw new Error(`Organization not found in checkpoint: ${orgId}`);
    }

    org.status = 'in_progress';
    org.startedAt = Date.now();

    await this.saveCheckpoint();
  }

  /**
   * Mark organization as completed
   */
  async completeOrganization(
    orgId: string,
    usersExported: number,
    usersSkipped: number
  ): Promise<void> {
    const org = this.state.organizations.find(o => o.orgId === orgId);
    if (!org) {
      throw new Error(`Organization not found in checkpoint: ${orgId}`);
    }

    org.status = 'completed';
    org.usersExported = usersExported;
    org.usersSkipped = usersSkipped;
    org.completedAt = Date.now();

    // Update summary
    this.state.summary.completedOrgs += 1;
    this.state.summary.totalUsers += usersExported;
    this.state.summary.skippedUsers += usersSkipped;

    await this.saveCheckpoint();
  }

  /**
   * Mark organization as failed
   */
  async failOrganization(orgId: string, error: string): Promise<void> {
    const org = this.state.organizations.find(o => o.orgId === orgId);
    if (!org) {
      throw new Error(`Organization not found in checkpoint: ${orgId}`);
    }

    org.status = 'failed';
    org.error = error;
    org.completedAt = Date.now();

    // Update summary
    this.state.summary.failedOrgs += 1;

    await this.saveCheckpoint();
  }

  /**
   * Add a warning to the summary
   */
  async addWarning(warning: string): Promise<void> {
    this.state.summary.warnings.push(warning);
    await this.saveCheckpoint();
  }

  /**
   * Mark entire export as completed
   */
  async complete(): Promise<void> {
    this.state.status = 'completed';
    this.state.updatedAt = Date.now();
    await this.saveCheckpoint();
  }

  /**
   * Mark entire export as failed
   */
  async fail(error: string): Promise<void> {
    this.state.status = 'failed';
    this.state.error = error;
    this.state.updatedAt = Date.now();
    await this.saveCheckpoint();
  }

  /**
   * Save checkpoint state to disk (atomic write)
   */
  async saveCheckpoint(): Promise<void> {
    this.state.updatedAt = Date.now();

    // Atomic write: write to temp file, then rename
    const tempPath = `${this.checkpointPath}.tmp`;
    await fs.promises.writeFile(
      tempPath,
      JSON.stringify(this.state, null, 2),
      'utf8'
    );
    await fs.promises.rename(tempPath, this.checkpointPath);
  }

  /**
   * Get current state (read-only)
   */
  getState(): Readonly<ExportCheckpointState> {
    return this.state;
  }

  /**
   * Get summary
   */
  getSummary(): ExportSummary {
    return { ...this.state.summary };
  }

  /**
   * Get job ID
   */
  getJobId(): string {
    return this.state.jobId;
  }

  /**
   * Get CSV output path
   */
  getCsvPath(): string {
    return this.state.csvPath;
  }

  /**
   * Check if export is completed
   */
  isCompleted(): boolean {
    return this.state.status === 'completed';
  }

  /**
   * Check if export has failed
   */
  isFailed(): boolean {
    return this.state.status === 'failed';
  }

  /**
   * Check if export is in progress
   */
  isInProgress(): boolean {
    return this.state.status === 'in_progress';
  }
}
