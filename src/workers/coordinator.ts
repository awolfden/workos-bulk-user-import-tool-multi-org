/**
 * Phase 4: Worker coordinator for managing worker pool
 *
 * The coordinator is responsible for:
 * - Creating and managing worker threads
 * - Distributing chunks to available workers
 * - Coordinating rate limiting across all workers
 * - Merging cache updates from workers
 * - Tracking progress and saving checkpoints
 */

import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  WorkerMessage,
  CoordinatorMessage,
  InitializePayload,
  ProcessChunkPayload,
  ChunkCompletePayload,
  ChunkFailedPayload,
  CacheUpdate,
  WorkerImportOptions
} from './types.js';
import type { ChunkMetadata, ImportSummary } from '../types.js';
import { RateLimiter } from '../rateLimiter.js';
import { CheckpointManager } from '../checkpoint/manager.js';
import { OrganizationCache } from '../cache/organizationCache.js';
import { createLogger } from '../logger.js';
import { ProgressUI } from '../ui/progressUI.js';
import { extractUniqueOrganizations } from '../utils/csvScanner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Coordinator configuration options
 */
export interface CoordinatorOptions {
  checkpointManager: CheckpointManager;
  numWorkers: number;
  orgCache: OrganizationCache | null;
  importOptions: WorkerImportOptions;
}

/**
 * Worker coordinator class
 * Manages worker pool and coordinates chunk processing
 */
export class WorkerCoordinator {
  private workers: Worker[] = [];
  private availableWorkers: Set<number> = new Set();
  private chunkQueue: ChunkMetadata[] = [];
  private activeChunks: Map<number, number> = new Map(); // chunkId -> workerId
  private rateLimiter: RateLimiter;
  private checkpointManager: CheckpointManager;
  private orgCache: OrganizationCache | null;
  private importOptions: WorkerImportOptions;
  private numWorkers: number;
  private logger: ReturnType<typeof createLogger>;
  private workerPath: string;
  private allChunksDispatched: boolean = false;
  private chunkCompletionPromises: Map<number, { resolve: () => void; reject: (err: Error) => void }> = new Map();
  private checkpointSaveLock: Promise<void> = Promise.resolve();
  private progressUI: ProgressUI;
  private startTime: number = Date.now();

  constructor(options: CoordinatorOptions, logger: ReturnType<typeof createLogger>) {
    this.checkpointManager = options.checkpointManager;
    this.numWorkers = options.numWorkers;
    this.orgCache = options.orgCache;
    this.importOptions = options.importOptions;
    this.logger = logger;
    this.rateLimiter = new RateLimiter(50); // Global 50 rps limit
    this.progressUI = new ProgressUI(options.importOptions.quiet);

    // Resolve worker path (compiled JS file)
    // Note: Worker threads need compiled JavaScript, not TypeScript
    this.workerPath = path.join(__dirname, '../../dist/workers/workers/worker.js');
  }

  /**
   * Pre-warm organization cache by scanning CSV and resolving all unique organizations
   *
   * This eliminates race conditions by resolving/creating all organizations single-threaded
   * before workers start processing. Workers then benefit from 100% cache hit rate.
   *
   * @private
   */
  private async prewarmOrganizations(): Promise<void> {
    if (!this.orgCache) {
      return; // No cache to warm (single-org or user-only mode)
    }

    const csvPath = this.importOptions.csvPath;

    this.logger.log('Pre-warming organization cache...');

    // Step 1: Scan CSV for unique organizations
    let uniqueOrgs;
    try {
      uniqueOrgs = await extractUniqueOrganizations(csvPath);
    } catch (err: any) {
      throw new Error(`Failed to scan CSV for organizations: ${err.message}`);
    }

    if (uniqueOrgs.length === 0) {
      this.logger.log('No organizations found in CSV (user-only mode)');
      return;
    }

    this.logger.log(`Found ${uniqueOrgs.length} unique organizations to pre-warm`);

    // Step 2: Resolve each organization sequentially (no race conditions)
    let resolved = 0;
    let created = 0;
    let failed = 0;
    const errors: Array<{ orgExternalId: string; error: string }> = [];

    const startTime = Date.now();

    for (let i = 0; i < uniqueOrgs.length; i++) {
      const org = uniqueOrgs[i];

      try {
        // Track cache size before resolution to detect new creations
        const cacheSizeBefore = this.orgCache.getStats().size;

        const orgId = await this.orgCache.resolve({
          orgExternalId: org.orgExternalId,
          createIfMissing: Boolean(org.orgName),
          orgName: org.orgName || undefined
        });

        if (orgId) {
          resolved++;

          // Check if this was a new creation
          const cacheSizeAfter = this.orgCache.getStats().size;
          if (cacheSizeAfter > cacheSizeBefore) {
            created++;
          }
        } else {
          // Org not found and no name provided for creation
          failed++;
          errors.push({
            orgExternalId: org.orgExternalId,
            error: 'Organization not found and no org_name provided for creation'
          });
        }

        // Progress update every 10 orgs or on last org
        if ((resolved + failed) % 10 === 0 || i === uniqueOrgs.length - 1) {
          const progress = Math.round(((i + 1) / uniqueOrgs.length) * 100);
          this.logger.log(
            `Pre-warming progress: ${i + 1}/${uniqueOrgs.length} (${progress}%) - ` +
            `${resolved} resolved, ${created} created, ${failed} failed`
          );
        }

      } catch (err: any) {
        failed++;
        errors.push({
          orgExternalId: org.orgExternalId,
          error: err.message || String(err)
        });

        this.logger.warn(
          `Failed to resolve organization ${org.orgExternalId}: ${err.message}`
        );
      }
    }

    const duration = Date.now() - startTime;
    const durationSec = (duration / 1000).toFixed(1);

    this.logger.log(
      `Pre-warming complete in ${durationSec}s: ` +
      `${resolved} resolved, ${created} created, ${failed} failed`
    );

    // Abort if too many failures (likely systematic issue)
    if (failed > uniqueOrgs.length * 0.1) {
      throw new Error(
        `Pre-warming failed for ${failed}/${uniqueOrgs.length} organizations (${Math.round(failed/uniqueOrgs.length*100)}%). ` +
        `This may indicate a systematic issue. First error: ${errors[0]?.error || 'unknown'}`
      );
    }

    if (failed > 0) {
      this.logger.warn(
        `Warning: ${failed} organizations could not be pre-warmed. ` +
        `Users for these orgs may fail during import.`
      );
    }

    // Display cache statistics
    const stats = this.orgCache.getStats();
    this.logger.log(
      `Organization cache ready: ${stats.size} organizations cached ` +
      `(hit rate will be ~100% during import)`
    );
  }

  /**
   * Start the coordinator and process all chunks
   */
  async start(): Promise<ImportSummary> {
    this.startTime = Date.now();

    // Pre-warm organization cache before starting workers
    // This eliminates race conditions by resolving all orgs single-threaded
    if (this.orgCache) {
      await this.prewarmOrganizations();
    }

    await this.initializeWorkers();
    this.loadChunkQueue();

    // Initialize progress UI
    const totalChunks = this.chunkQueue.length;
    this.progressUI.startImport(totalChunks);
    if (this.numWorkers > 1) {
      this.progressUI.initializeWorkers(this.numWorkers);
    }

    await this.processAllChunks();
    await this.shutdownWorkers();

    const summary = this.checkpointManager.getFinalSummary();
    const duration = Date.now() - this.startTime;
    const throughput = duration > 0 ? (summary.successes / duration) * 1000 : 0;

    // Display rich summary
    this.progressUI.displaySummary({
      totalUsers: summary.total,
      imported: summary.successes,
      failed: summary.failures,
      cacheHits: summary.cacheStats?.hits || 0,
      cacheMisses: summary.cacheStats?.misses || 0,
      duration,
      throughput,
      membershipsCreated: summary.membershipsCreated
    }, 'worker-pool');

    this.progressUI.stop();

    return summary;
  }

  /**
   * Initialize worker pool
   * Creates workers, sends initialize messages, waits for ready
   */
  private async initializeWorkers(): Promise<void> {
    const cacheEntries = this.orgCache?.serialize() || [];
    const checkpointDir = this.checkpointManager.getCheckpointDir();

    const workerReadyPromises: Promise<void>[] = [];

    for (let i = 0; i < this.numWorkers; i++) {
      const worker = new Worker(this.workerPath, {
        workerData: { workerId: i }
      });

      // Set up message handler
      worker.on('message', (msg: WorkerMessage) => this.handleWorkerMessage(i, msg));

      // Handle worker errors
      worker.on('error', (err) => {
        this.logger.error(`Worker ${i} error:`, err);
        this.handleWorkerFailure(i, err);
      });

      // Handle worker exit
      worker.on('exit', (code) => {
        if (code !== 0) {
          this.logger.error(`Worker ${i} exited with code ${code}`);
          this.handleWorkerFailure(i, new Error(`Worker exited with code ${code}`));
        }
      });

      this.workers.push(worker);

      // Wait for ready message
      const readyPromise = new Promise<void>((resolve) => {
        const handler = (msg: WorkerMessage) => {
          if (msg.type === 'ready') {
            worker.off('message', handler);
            this.availableWorkers.add(i);
            resolve();
          }
        };
        worker.on('message', handler);
      });

      workerReadyPromises.push(readyPromise);

      // Send initialize message
      const initPayload: InitializePayload = {
        cacheEntries,
        options: this.importOptions,
        checkpointDir
      };

      worker.postMessage({
        type: 'initialize',
        payload: initPayload
      } as CoordinatorMessage);
    }

    // Wait for all workers to be ready
    await Promise.all(workerReadyPromises);
  }

  /**
   * Load pending chunks from checkpoint manager
   */
  private loadChunkQueue(): void {
    const state = this.checkpointManager.getState();
    const pendingChunks = state.chunks.filter(c => c.status === 'pending');

    this.chunkQueue = [...pendingChunks];
  }

  /**
   * Process all chunks by dispatching to workers
   * Waits for all chunks to complete
   */
  private async processAllChunks(): Promise<void> {
    // Start initial dispatch
    this.dispatchChunks();

    // Wait for all chunks to complete
    while (this.activeChunks.size > 0 || this.chunkQueue.length > 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  /**
   * Dispatch chunks to available workers
   * Pulls from queue and assigns to available workers
   */
  private dispatchChunks(): void {
    while (this.chunkQueue.length > 0 && this.availableWorkers.size > 0) {
      const chunk = this.chunkQueue.shift()!;
      const workerIdIter = this.availableWorkers.values().next();

      if (workerIdIter.done || workerIdIter.value === undefined) {
        // No available workers (shouldn't happen due to while condition, but be safe)
        this.chunkQueue.unshift(chunk); // Put chunk back
        break;
      }

      const workerId: number = workerIdIter.value;
      this.availableWorkers.delete(workerId);

      this.activeChunks.set(chunk.chunkId, workerId);

      const payload: ProcessChunkPayload = {
        chunk
      };

      const worker = this.workers[workerId];
      if (!worker) {
        this.logger.error(`Worker ${workerId} not found in pool`);
        this.chunkQueue.unshift(chunk); // Put chunk back
        continue;
      }

      worker.postMessage({
        type: 'process-chunk',
        payload
      } as CoordinatorMessage);
    }

    if (this.chunkQueue.length === 0 && !this.allChunksDispatched) {
      this.allChunksDispatched = true;
    }
  }

  /**
   * Handle messages from workers
   */
  private handleWorkerMessage(workerId: number, msg: WorkerMessage): void {
    switch (msg.type) {
      case 'ready':
        // Already handled during initialization
        break;

      case 'rate-limit-request':
        this.handleRateLimitRequest(workerId, msg.requestId);
        break;

      case 'chunk-complete':
        this.handleChunkComplete(workerId, msg.payload);
        break;

      case 'chunk-failed':
        this.handleChunkFailed(workerId, msg.payload);
        break;

      default:
        this.logger.warn(`Unknown worker message type from worker ${workerId}:`, (msg as any).type);
    }
  }

  /**
   * Handle rate limit request from worker
   * Acquires from global rate limiter and grants to worker
   */
  private async handleRateLimitRequest(workerId: number, requestId: string): Promise<void> {
    // Acquire from global rate limiter
    await this.rateLimiter.acquire();

    // Grant to worker
    const worker = this.workers[workerId];
    if (!worker) {
      this.logger.error(`Cannot grant rate limit: worker ${workerId} not found`);
      return;
    }

    worker.postMessage({
      type: 'rate-limit-grant',
      requestId
    } as CoordinatorMessage);
  }

  /**
   * Handle chunk completion from worker
   * Merges cache updates, saves checkpoint, dispatches next chunk
   */
  private async handleChunkComplete(workerId: number, payload: ChunkCompletePayload): Promise<void> {
    const { chunkId, summary, cacheUpdates } = payload;

    // Mark chunk as completed in checkpoint
    this.checkpointManager.markChunkCompleted(chunkId, summary);

    // Merge cache updates
    if (this.orgCache && cacheUpdates.length > 0) {
      this.mergeCacheUpdates(cacheUpdates);
      this.checkpointManager.serializeCache(this.orgCache);
    }

    // Save checkpoint with lock to prevent concurrent saves
    this.checkpointSaveLock = this.checkpointSaveLock.then(async () => {
      await this.checkpointManager.saveCheckpoint();
    });
    await this.checkpointSaveLock;

    // Remove from active chunks
    this.activeChunks.delete(chunkId);

    // Mark worker as available
    this.availableWorkers.add(workerId);

    // Update progress UI
    const state = this.checkpointManager.getState();
    const completedChunks = state.chunks.filter(c => c.status === 'completed').length;
    const totalChunks = state.chunks.length;
    this.progressUI.updateProgress(completedChunks, totalChunks);

    // Update worker-specific progress
    if (this.numWorkers > 1) {
      this.progressUI.updateWorker(workerId, chunkId, totalChunks);
    }

    // Dispatch next chunk if available
    this.dispatchChunks();
  }

  /**
   * Handle chunk failure from worker
   * Logs error, requeues chunk for retry (optional), dispatches next
   */
  private handleChunkFailed(workerId: number, payload: ChunkFailedPayload): void {
    const { chunkId, error, partialSummary } = payload;

    this.logger.error(`Chunk ${chunkId} failed on worker ${workerId}: ${error}`);

    // Mark chunk as failed in checkpoint (keep status as pending for retry)
    // For now, we'll just log and continue - in production you might want retry logic

    // Remove from active chunks
    this.activeChunks.delete(chunkId);

    // Mark worker as available
    this.availableWorkers.add(workerId);

    // Dispatch next chunk
    this.dispatchChunks();
  }

  /**
   * Handle worker failure (crash, exit)
   * Requeues active chunks from failed worker
   */
  private handleWorkerFailure(workerId: number, error: Error): void {
    this.logger.error(`Worker ${workerId} failed:`, error);

    // Find chunks assigned to failed worker and requeue
    for (const [chunkId, wId] of this.activeChunks.entries()) {
      if (wId === workerId) {
        const state = this.checkpointManager.getState();
        const chunk = state.chunks.find(c => c.chunkId === chunkId);
        if (chunk) {
          this.logger.log(`Requeuing chunk ${chunkId} from failed worker ${workerId}`);
          this.chunkQueue.unshift(chunk); // Add to front of queue
        }
        this.activeChunks.delete(chunkId);
      }
    }

    // Remove worker from available set
    this.availableWorkers.delete(workerId);

    // Dispatch chunks to remaining workers
    this.dispatchChunks();
  }

  /**
   * Merge cache updates from worker into coordinator's cache
   * Uses OrganizationCache's mergeEntries method to avoid duplicates
   */
  private mergeCacheUpdates(updates: CacheUpdate[]): void {
    if (!this.orgCache) return;

    // Convert CacheUpdate[] to SerializedCacheEntry[] format
    const entries = updates.map(update => ({
      key: update.key,
      id: update.id,
      externalId: update.externalId,
      name: update.name
    }));

    this.orgCache.mergeEntries(entries);
  }

  /**
   * Shutdown all workers gracefully
   */
  private async shutdownWorkers(): Promise<void> {
    const shutdownPromises = this.workers.map((worker, i) => {
      return new Promise<void>((resolve) => {
        worker.on('exit', () => resolve());

        worker.postMessage({
          type: 'shutdown'
        } as CoordinatorMessage);

        // Force terminate after 5 seconds if not exited
        setTimeout(() => {
          worker.terminate();
          resolve();
        }, 5000);
      });
    });

    await Promise.all(shutdownPromises);
  }
}
