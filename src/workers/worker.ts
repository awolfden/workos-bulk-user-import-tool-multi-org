/**
 * Phase 4: Worker thread entry point
 *
 * This worker receives chunks from the coordinator, processes them using
 * the distributed rate limiter, and returns results via IPC messages.
 *
 * Message flow:
 * 1. Coordinator sends 'initialize' with cache and options
 * 2. Worker responds with 'ready'
 * 3. Coordinator sends 'process-chunk' with chunk metadata
 * 4. Worker processes chunk, sends 'chunk-complete' or 'chunk-failed'
 * 5. Worker requests rate limits via 'rate-limit-request'
 * 6. Coordinator grants via 'rate-limit-grant'
 */

import { parentPort, workerData } from 'node:worker_threads';
import type {
  CoordinatorMessage,
  WorkerMessage,
  InitializePayload,
  ProcessChunkPayload,
  ChunkCompletePayload,
  ChunkFailedPayload,
  WorkerImportOptions,
  CacheUpdate
} from './types.js';
import { DistributedRateLimiter } from './distributedRateLimiter.js';
import { processChunkInWorker } from './chunkProcessor.js';
import { OrganizationCache } from '../cache/organizationCache.js';

// Worker state
let orgCache: OrganizationCache | null = null;
let rateLimiter: DistributedRateLimiter | null = null;
let importOptions: WorkerImportOptions | null = null;
let checkpointDir: string = '';
let isShuttingDown = false;

/**
 * Send message to coordinator
 */
function sendMessage(msg: WorkerMessage): void {
  if (parentPort && !isShuttingDown) {
    parentPort.postMessage(msg);
  }
}

/**
 * Handle initialization message from coordinator
 * Sets up local cache and rate limiter
 */
async function handleInitialize(payload: InitializePayload): Promise<void> {
  try {
    // Restore organization cache from serialized entries
    if (payload.cacheEntries && payload.cacheEntries.length > 0) {
      orgCache = OrganizationCache.deserialize(payload.cacheEntries);
      console.log(`[Worker ${workerData?.workerId ?? '?'}] Initialized cache with ${payload.cacheEntries.length} entries`);
    } else {
      // Multi-org mode without existing cache
      if (payload.options.orgId === null) {
        orgCache = new OrganizationCache({ maxSize: 10000 });
        console.log(`[Worker ${workerData?.workerId ?? '?'}] Initialized empty cache for multi-org mode`);
      }
    }

    // Initialize distributed rate limiter
    rateLimiter = new DistributedRateLimiter();

    // Store import options and checkpoint directory
    importOptions = payload.options;
    checkpointDir = payload.checkpointDir;

    console.log(`[Worker ${workerData?.workerId ?? '?'}] Initialized successfully`);

    // Signal ready to coordinator
    sendMessage({ type: 'ready' });
  } catch (err: any) {
    console.error(`[Worker ${workerData?.workerId ?? '?'}] Initialization failed:`, err);
    process.exit(1);
  }
}

/**
 * Handle process chunk message from coordinator
 * Processes the chunk and sends results back
 */
async function handleProcessChunk(payload: ProcessChunkPayload): Promise<void> {
  if (!rateLimiter || !importOptions) {
    sendMessage({
      type: 'chunk-failed',
      payload: {
        chunkId: payload.chunk.chunkId,
        error: 'Worker not initialized'
      }
    });
    return;
  }

  const { chunk } = payload;
  const chunkId = chunk.chunkId;

  console.log(`[Worker ${workerData?.workerId ?? '?'}] Processing chunk ${chunkId} (rows ${chunk.startRow}-${chunk.endRow})`);

  try {
    // Process the chunk
    const summary = await processChunkInWorker(
      chunk,
      importOptions,
      orgCache,
      rateLimiter,
      checkpointDir
    );

    // Collect cache updates (new entries discovered by this worker)
    const cacheUpdates: CacheUpdate[] = [];
    if (orgCache) {
      const serialized = orgCache.serialize();
      // Only send updates if cache has entries
      for (const entry of serialized) {
        cacheUpdates.push({
          key: entry.key,
          id: entry.id,
          externalId: entry.externalId,
          name: entry.name
        });
      }
    }

    console.log(`[Worker ${workerData?.workerId ?? '?'}] Completed chunk ${chunkId}: ${summary.successes} successes, ${summary.failures} failures`);

    // Send completion message
    const completePayload: ChunkCompletePayload = {
      chunkId,
      summary,
      cacheUpdates
    };

    sendMessage({
      type: 'chunk-complete',
      payload: completePayload
    });
  } catch (err: any) {
    console.error(`[Worker ${workerData?.workerId ?? '?'}] Chunk ${chunkId} failed:`, err);

    const failedPayload: ChunkFailedPayload = {
      chunkId,
      error: err.message || String(err)
    };

    sendMessage({
      type: 'chunk-failed',
      payload: failedPayload
    });
  }
}

/**
 * Handle shutdown message from coordinator
 * Cleanup and exit gracefully
 */
function handleShutdown(): void {
  console.log(`[Worker ${workerData?.workerId ?? '?'}] Shutting down...`);
  isShuttingDown = true;

  // Cleanup rate limiter
  if (rateLimiter) {
    rateLimiter.cleanup();
  }

  // Exit cleanly
  process.exit(0);
}

/**
 * Main message handler
 * Routes incoming coordinator messages to appropriate handlers
 */
if (!parentPort) {
  console.error('Worker must be run as a worker thread (parentPort is null)');
  process.exit(1);
}

parentPort.on('message', async (msg: CoordinatorMessage) => {
  try {
    switch (msg.type) {
      case 'initialize':
        await handleInitialize(msg.payload);
        break;

      case 'process-chunk':
        await handleProcessChunk(msg.payload);
        break;

      case 'rate-limit-grant':
        // Handled by DistributedRateLimiter's message handler
        // (already set up in DistributedRateLimiter constructor)
        break;

      case 'shutdown':
        handleShutdown();
        break;

      default:
        console.warn(`[Worker ${workerData?.workerId ?? '?'}] Unknown message type:`, (msg as any).type);
    }
  } catch (err) {
    console.error(`[Worker ${workerData?.workerId ?? '?'}] Error handling message:`, err);
  }
});

// Handle uncaught errors
process.on('uncaughtException', (err) => {
  console.error(`[Worker ${workerData?.workerId ?? '?'}] Uncaught exception:`, err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error(`[Worker ${workerData?.workerId ?? '?'}] Unhandled rejection:`, reason);
  process.exit(1);
});

console.log(`[Worker ${workerData?.workerId ?? '?'}] Started, waiting for initialization...`);
