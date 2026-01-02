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

  constructor(options: CoordinatorOptions, logger: ReturnType<typeof createLogger>) {
    this.checkpointManager = options.checkpointManager;
    this.numWorkers = options.numWorkers;
    this.orgCache = options.orgCache;
    this.importOptions = options.importOptions;
    this.logger = logger;
    this.rateLimiter = new RateLimiter(50); // Global 50 rps limit

    // Resolve worker path (compiled JS file)
    // In development: dist/workers/workers/worker.js
    // In production: adjust as needed
    this.workerPath = path.join(__dirname, '../../dist/workers/workers/worker.js');
  }

  /**
   * Start the coordinator and process all chunks
   */
  async start(): Promise<ImportSummary> {
    this.logger.log(`Starting coordinator with ${this.numWorkers} workers...`);

    await this.initializeWorkers();
    this.loadChunkQueue();
    await this.processAllChunks();
    await this.shutdownWorkers();

    return this.checkpointManager.getFinalSummary();
  }

  /**
   * Initialize worker pool
   * Creates workers, sends initialize messages, waits for ready
   */
  private async initializeWorkers(): Promise<void> {
    this.logger.log('Initializing worker pool...');

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
            this.logger.log(`Worker ${i} ready`);
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
    this.logger.log(`All ${this.numWorkers} workers initialized`);
  }

  /**
   * Load pending chunks from checkpoint manager
   */
  private loadChunkQueue(): void {
    const state = this.checkpointManager.getState();
    const pendingChunks = state.chunks.filter(c => c.status === 'pending');

    this.chunkQueue = [...pendingChunks];
    this.logger.log(`Loaded ${this.chunkQueue.length} pending chunks`);
  }

  /**
   * Process all chunks by dispatching to workers
   * Waits for all chunks to complete
   */
  private async processAllChunks(): Promise<void> {
    this.logger.log('Starting chunk processing...');

    // Start initial dispatch
    this.dispatchChunks();

    // Wait for all chunks to complete
    while (this.activeChunks.size > 0 || this.chunkQueue.length > 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    this.logger.log('All chunks processed');
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

      this.logger.log(`Dispatching chunk ${chunk.chunkId} to worker ${workerId}`);

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
      this.logger.log('All chunks dispatched');
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

    this.logger.log(
      `Chunk ${chunkId} completed by worker ${workerId}: ` +
      `${summary.successes} successes, ${summary.failures} failures`
    );

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
    this.logger.log('Shutting down workers...');

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
    this.logger.log('All workers shut down');
  }
}
