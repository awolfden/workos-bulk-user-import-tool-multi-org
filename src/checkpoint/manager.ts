/**
 * Phase 3: Checkpoint manager for resumable imports
 *
 * Handles checkpoint file I/O, state management, progress tracking,
 * and organization cache serialization/restoration.
 */

import fs from 'node:fs';
import path from 'node:path';
import { OrganizationCache } from '../cache/organizationCache.js';
import type { ImportSummary } from '../types.js';
import type {
  CheckpointState,
  ChunkMetadata,
  ChunkSummary,
  CreateCheckpointOptions,
  ProgressStats,
  SerializedCacheEntry
} from './types.js';

const DEFAULT_CHECKPOINT_DIR = '.workos-checkpoints';

export class CheckpointManager {
  private readonly checkpointDir: string;
  private readonly jobId: string;
  private state: CheckpointState;
  private readonly checkpointPath: string;

  private constructor(jobId: string, state: CheckpointState, checkpointDir: string) {
    this.jobId = jobId;
    this.state = state;
    this.checkpointDir = path.join(checkpointDir, jobId);
    this.checkpointPath = path.join(this.checkpointDir, 'checkpoint.json');
  }

  // ============================================================================
  // Static Factory Methods
  // ============================================================================

  /**
   * Create a new checkpoint for a fresh import job
   */
  static async create(options: CreateCheckpointOptions): Promise<CheckpointManager> {
    const checkpointDir = options.checkpointDir || DEFAULT_CHECKPOINT_DIR;
    const jobDir = path.join(checkpointDir, options.jobId);

    // Create checkpoint directory
    await fs.promises.mkdir(jobDir, { recursive: true });

    // Calculate number of chunks
    const totalChunks = Math.ceil(options.totalRows / options.chunkSize);

    // Initialize chunks
    const chunks: ChunkMetadata[] = [];
    for (let i = 0; i < totalChunks; i++) {
      const startRow = i * options.chunkSize + 1;
      const endRow = Math.min((i + 1) * options.chunkSize, options.totalRows);

      chunks.push({
        chunkId: i,
        startRow,
        endRow,
        status: 'pending',
        successes: 0,
        failures: 0,
        membershipsCreated: 0,
        usersCreated: 0,
        duplicateUsers: 0,
        duplicateMemberships: 0
      });
    }

    // Initialize checkpoint state
    const now = Date.now();
    const state: CheckpointState = {
      jobId: options.jobId,
      csvPath: options.csvPath,
      csvHash: options.csvHash,
      createdAt: now,
      updatedAt: now,
      chunkSize: options.chunkSize,
      concurrency: options.concurrency,
      totalRows: options.totalRows,
      chunks,
      summary: {
        total: 0,
        successes: 0,
        failures: 0,
        membershipsCreated: 0,
        usersCreated: 0,
        duplicateUsers: 0,
        duplicateMemberships: 0,
        startedAt: now,
        endedAt: null,
        warnings: []
      },
      mode: options.mode,
      orgId: options.orgId
    };

    const manager = new CheckpointManager(options.jobId, state, checkpointDir);

    // Save initial checkpoint
    await manager.saveCheckpoint();

    return manager;
  }

  /**
   * Resume from an existing checkpoint
   */
  static async resume(jobId: string, checkpointDir?: string): Promise<CheckpointManager> {
    const dir = checkpointDir || DEFAULT_CHECKPOINT_DIR;
    const jobDir = path.join(dir, jobId);
    const checkpointPath = path.join(jobDir, 'checkpoint.json');

    // Check if checkpoint exists
    if (!fs.existsSync(checkpointPath)) {
      throw new Error(`Checkpoint not found for job: ${jobId} at ${checkpointPath}`);
    }

    // Load checkpoint
    const data = await fs.promises.readFile(checkpointPath, 'utf8');
    const state: CheckpointState = JSON.parse(data);

    return new CheckpointManager(jobId, state, dir);
  }

  /**
   * Check if a checkpoint exists for a job
   */
  static async exists(jobId: string, checkpointDir?: string): Promise<boolean> {
    const dir = checkpointDir || DEFAULT_CHECKPOINT_DIR;
    const checkpointPath = path.join(dir, jobId, 'checkpoint.json');
    return fs.existsSync(checkpointPath);
  }

  // ============================================================================
  // State Management
  // ============================================================================

  /**
   * Save checkpoint to disk (atomic write)
   */
  async saveCheckpoint(): Promise<void> {
    this.state.updatedAt = Date.now();

    // Ensure directory exists (defensive programming for worker environments)
    await fs.promises.mkdir(this.checkpointDir, { recursive: true });

    // Atomic write: write to temp file, then rename
    const tempPath = `${this.checkpointPath}.tmp`;
    await fs.promises.writeFile(tempPath, JSON.stringify(this.state, null, 2), 'utf8');
    await fs.promises.rename(tempPath, this.checkpointPath);
  }

  /**
   * Get current checkpoint state (read-only)
   */
  getState(): Readonly<CheckpointState> {
    return this.state;
  }

  /**
   * Get job ID
   */
  getJobId(): string {
    return this.jobId;
  }

  /**
   * Get checkpoint directory path
   */
  getCheckpointDir(): string {
    return this.checkpointDir;
  }

  /**
   * Get checkpoint file path
   */
  getCheckpointPath(): string {
    return this.checkpointPath;
  }

  // ============================================================================
  // Chunk Progress Tracking
  // ============================================================================

  /**
   * Get next pending chunk to process (null if all done)
   */
  getNextPendingChunk(): ChunkMetadata | null {
    return this.state.chunks.find(c => c.status === 'pending') || null;
  }

  /**
   * Mark a chunk as started
   */
  markChunkStarted(chunkId: number): void {
    const chunk = this.state.chunks[chunkId];
    if (!chunk) {
      throw new Error(`Invalid chunk ID: ${chunkId}`);
    }

    chunk.status = 'pending'; // Will be updated to completed/failed later
    chunk.startedAt = Date.now();
  }

  /**
   * Mark a chunk as successfully completed
   */
  markChunkCompleted(chunkId: number, chunkSummary: ChunkSummary): void {
    const chunk = this.state.chunks[chunkId];
    if (!chunk) {
      throw new Error(`Invalid chunk ID: ${chunkId}`);
    }

    chunk.status = 'completed';
    chunk.completedAt = Date.now();
    chunk.durationMs = chunkSummary.durationMs;
    chunk.successes = chunkSummary.successes;
    chunk.failures = chunkSummary.failures;
    chunk.membershipsCreated = chunkSummary.membershipsCreated;
    chunk.usersCreated = chunkSummary.usersCreated;
    chunk.duplicateUsers = chunkSummary.duplicateUsers;
    chunk.duplicateMemberships = chunkSummary.duplicateMemberships;
    chunk.rolesAssigned = chunkSummary.rolesAssigned;

    // Update cumulative summary
    this.updateSummary(chunkSummary);
  }

  /**
   * Mark a chunk as failed (will be retried on resume)
   */
  markChunkFailed(chunkId: number): void {
    const chunk = this.state.chunks[chunkId];
    if (!chunk) {
      throw new Error(`Invalid chunk ID: ${chunkId}`);
    }

    chunk.status = 'failed';
  }

  // ============================================================================
  // Summary Management
  // ============================================================================

  /**
   * Update cumulative summary with chunk results
   */
  updateSummary(chunkSummary: ChunkSummary): void {
    this.state.summary.total += chunkSummary.successes + chunkSummary.failures;
    this.state.summary.successes += chunkSummary.successes;
    this.state.summary.failures += chunkSummary.failures;
    this.state.summary.membershipsCreated += chunkSummary.membershipsCreated;
    this.state.summary.usersCreated += chunkSummary.usersCreated;
    this.state.summary.duplicateUsers += chunkSummary.duplicateUsers;
    this.state.summary.duplicateMemberships += chunkSummary.duplicateMemberships;
    this.state.summary.rolesAssigned = (this.state.summary.rolesAssigned ?? 0) + (chunkSummary.rolesAssigned ?? 0);
    if (chunkSummary.warnings?.length) {
      this.state.summary.warnings.push(...chunkSummary.warnings);
    }
  }

  /**
   * Get final ImportSummary (for return to CLI)
   */
  getFinalSummary(): ImportSummary {
    const progress = this.getProgress();

    return {
      total: this.state.summary.total,
      successes: this.state.summary.successes,
      failures: this.state.summary.failures,
      membershipsCreated: this.state.summary.membershipsCreated,
      usersCreated: this.state.summary.usersCreated,
      duplicateUsers: this.state.summary.duplicateUsers,
      duplicateMemberships: this.state.summary.duplicateMemberships,
      rolesAssigned: this.state.summary.rolesAssigned ?? 0,
      roleAssignmentFailures: this.state.summary.roleAssignmentFailures ?? 0,
      startedAt: this.state.summary.startedAt,
      endedAt: Date.now(),
      warnings: this.state.summary.warnings,
      chunkProgress: {
        completedChunks: progress.completedChunks,
        totalChunks: progress.totalChunks,
        percentComplete: progress.percentComplete
      },
      cacheStats: this.state.orgCache ? {
        hits: this.state.orgCache.stats.hits,
        misses: this.state.orgCache.stats.misses,
        hitRate: `${this.calculateHitRate(this.state.orgCache.stats.hits, this.state.orgCache.stats.misses)}%`
      } : undefined
    };
  }

  // ============================================================================
  // Progress Calculation
  // ============================================================================

  /**
   * Get current progress statistics
   */
  getProgress(): ProgressStats {
    const completedChunks = this.state.chunks.filter(c => c.status === 'completed').length;
    const totalChunks = this.state.chunks.length;
    const completedRows = this.state.summary.total;
    const totalRows = this.state.totalRows;
    const percentComplete = totalChunks > 0 ? Math.round((completedChunks / totalChunks) * 100) : 0;

    // Calculate average chunk time (last 5 chunks for stability)
    const completedChunksWithTime = this.state.chunks
      .filter(c => c.status === 'completed' && c.durationMs)
      .slice(-5); // Last 5 chunks

    const averageChunkTimeMs = completedChunksWithTime.length > 0
      ? completedChunksWithTime.reduce((sum, c) => sum + (c.durationMs || 0), 0) / completedChunksWithTime.length
      : null;

    // Estimate time remaining
    const remainingChunks = totalChunks - completedChunks;
    const estimatedTimeRemainingMs = averageChunkTimeMs && remainingChunks > 0
      ? averageChunkTimeMs * remainingChunks
      : null;

    return {
      completedChunks,
      totalChunks,
      completedRows,
      totalRows,
      percentComplete,
      estimatedTimeRemainingMs,
      averageChunkTimeMs
    };
  }

  // ============================================================================
  // Organization Cache Management
  // ============================================================================

  /**
   * Serialize organization cache to checkpoint
   */
  serializeCache(cache: OrganizationCache): void {
    const entries = cache.serialize();
    const stats = cache.getStats();

    this.state.orgCache = {
      entries,
      stats: {
        hits: stats.hits,
        misses: stats.misses,
        evictions: stats.evictions
      }
    };
  }

  /**
   * Restore organization cache from checkpoint
   */
  restoreCache(dryRun?: boolean): OrganizationCache | null {
    if (!this.state.orgCache) {
      return null;
    }

    const cache = OrganizationCache.deserialize(
      this.state.orgCache.entries,
      { maxSize: 10000, dryRun }
    );

    // Restore statistics
    const stats = cache.getStats();
    stats.hits = this.state.orgCache.stats.hits;
    stats.misses = this.state.orgCache.stats.misses;
    stats.evictions = this.state.orgCache.stats.evictions;

    return cache;
  }

  // ============================================================================
  // Cleanup
  // ============================================================================

  /**
   * Delete checkpoint directory and all files
   */
  async deleteCheckpoint(): Promise<void> {
    await fs.promises.rm(this.checkpointDir, { recursive: true, force: true });
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private calculateHitRate(hits: number, misses: number): string {
    const total = hits + misses;
    if (total === 0) return '0.0';
    return ((hits / total) * 100).toFixed(1);
  }
}

/**
 * Find the most recent job in the checkpoint directory
 * Used for --resume without job-id
 */
export async function findLastJob(checkpointDir?: string): Promise<string | null> {
  const dir = checkpointDir || DEFAULT_CHECKPOINT_DIR;

  if (!fs.existsSync(dir)) {
    return null;
  }

  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  const jobDirs = entries
    .filter(e => e.isDirectory())
    .map(e => e.name);

  if (jobDirs.length === 0) {
    return null;
  }

  // Find most recently modified job
  let latestJob: string | null = null;
  let latestTime = 0;

  for (const jobId of jobDirs) {
    const checkpointPath = path.join(dir, jobId, 'checkpoint.json');
    if (fs.existsSync(checkpointPath)) {
      const stats = await fs.promises.stat(checkpointPath);
      if (stats.mtimeMs > latestTime) {
        latestTime = stats.mtimeMs;
        latestJob = jobId;
      }
    }
  }

  return latestJob;
}
