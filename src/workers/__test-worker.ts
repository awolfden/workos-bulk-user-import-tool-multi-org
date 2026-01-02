/**
 * Manual test for Worker thread
 *
 * Run with: npx tsx src/workers/__test-worker.ts
 *
 * This test simulates a coordinator and verifies that the worker can:
 * 1. Initialize with cache and options
 * 2. Process a chunk from a test CSV
 * 3. Handle rate limit requests
 * 4. Return results via IPC
 * 5. Shutdown gracefully
 */

import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  WorkerMessage,
  CoordinatorMessage,
  InitializePayload,
  ProcessChunkPayload
} from './types.js';
import type { ChunkMetadata } from '../checkpoint/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('Worker Thread Manual Test');
console.log('=========================\n');

/**
 * Mock coordinator that manages a single worker for testing
 */
class MockCoordinator {
  private worker: Worker;
  private pendingRateLimits: Set<string> = new Set();

  constructor(workerPath: string, workerId: number) {
    console.log(`Creating worker thread (ID: ${workerId})...`);

    this.worker = new Worker(workerPath, {
      workerData: { workerId }
    });

    this.worker.on('message', (msg: WorkerMessage) => this.handleWorkerMessage(msg));
    this.worker.on('error', (err) => {
      console.error('Worker error:', err);
      process.exit(1);
    });
    this.worker.on('exit', (code) => {
      console.log(`Worker exited with code ${code}`);
    });
  }

  private handleWorkerMessage(msg: WorkerMessage): void {
    switch (msg.type) {
      case 'ready':
        console.log('✓ Worker is ready');
        break;

      case 'rate-limit-request':
        console.log(`  Rate limit request: ${msg.requestId}`);
        // Grant immediately (simulating fast coordinator)
        setTimeout(() => {
          this.worker.postMessage({
            type: 'rate-limit-grant',
            requestId: msg.requestId
          } as CoordinatorMessage);
        }, 10); // Small delay to simulate IPC
        break;

      case 'chunk-complete':
        console.log(`✓ Chunk ${msg.payload.chunkId} completed:`);
        console.log(`  - Successes: ${msg.payload.summary.successes}`);
        console.log(`  - Failures: ${msg.payload.summary.failures}`);
        console.log(`  - Memberships: ${msg.payload.summary.membershipsCreated}`);
        console.log(`  - Duration: ${msg.payload.summary.durationMs}ms`);
        console.log(`  - Cache updates: ${msg.payload.cacheUpdates.length}`);
        break;

      case 'chunk-failed':
        console.error(`✗ Chunk ${msg.payload.chunkId} failed:`);
        console.error(`  Error: ${msg.payload.error}`);
        break;

      default:
        console.warn('Unknown worker message type:', (msg as any).type);
    }
  }

  async initialize(): Promise<void> {
    console.log('Sending initialize message...');

    const payload: InitializePayload = {
      cacheEntries: [], // Empty cache for test
      options: {
        csvPath: path.join(__dirname, '../../examples/phase3-test-simple.csv'),
        concurrency: 2,
        orgId: 'org_test', // Single-org mode for simplicity
        requireMembership: false,
        dryRun: true // Dry run so we don't create actual users
      },
      checkpointDir: path.join(__dirname, '../../.workos-checkpoints')
    };

    this.worker.postMessage({
      type: 'initialize',
      payload
    } as CoordinatorMessage);

    // Wait for ready message
    await new Promise<void>((resolve) => {
      const handler = (msg: WorkerMessage) => {
        if (msg.type === 'ready') {
          this.worker.off('message', handler);
          resolve();
        }
      };
      this.worker.on('message', handler);
    });
  }

  async processChunk(chunk: ChunkMetadata): Promise<void> {
    console.log(`\nSending process-chunk message (chunk ${chunk.chunkId})...`);

    const payload: ProcessChunkPayload = {
      chunk
    };

    this.worker.postMessage({
      type: 'process-chunk',
      payload
    } as CoordinatorMessage);

    // Wait for chunk completion
    await new Promise<void>((resolve, reject) => {
      const handler = (msg: WorkerMessage) => {
        if (msg.type === 'chunk-complete' && msg.payload.chunkId === chunk.chunkId) {
          this.worker.off('message', handler);
          resolve();
        } else if (msg.type === 'chunk-failed' && msg.payload.chunkId === chunk.chunkId) {
          this.worker.off('message', handler);
          reject(new Error(msg.payload.error));
        }
      };
      this.worker.on('message', handler);
    });
  }

  shutdown(): Promise<void> {
    console.log('\nSending shutdown message...');

    this.worker.postMessage({
      type: 'shutdown'
    } as CoordinatorMessage);

    return new Promise<void>((resolve) => {
      this.worker.on('exit', () => resolve());
    });
  }
}

/**
 * Run the test
 */
async function runTest() {
  // Point to compiled worker in dist directory
  const workerPath = path.join(__dirname, '../../dist/workers/workers/worker.js');

  try {
    // Create mock coordinator with one worker
    const coordinator = new MockCoordinator(workerPath, 1);

    // Initialize worker
    await coordinator.initialize();

    // Process a test chunk (rows 1-3 from phase3-test-simple.csv)
    const testChunk: ChunkMetadata = {
      chunkId: 1,
      startRow: 1,
      endRow: 3,
      status: 'pending',
      successes: 0,
      failures: 0,
      membershipsCreated: 0
    };

    await coordinator.processChunk(testChunk);

    // Shutdown worker
    await coordinator.shutdown();

    console.log('\n=========================');
    console.log('Worker test completed ✓');
    console.log('=========================');
    console.log('\nPhase 4.2 validation: Worker can process chunks and return results ✓');

  } catch (err) {
    console.error('\n✗ Test failed:', err);
    process.exit(1);
  }
}

// Run test
runTest().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
