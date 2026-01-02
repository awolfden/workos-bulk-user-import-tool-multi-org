/**
 * Phase 4: Worker pool types for IPC communication
 */

import type {
  ChunkMetadata,
  ChunkSummary,
  SerializedCacheEntry
} from '../checkpoint/types.js';

/**
 * Messages sent from Coordinator (main thread) to Workers
 */
export type CoordinatorMessage =
  | { type: 'initialize'; payload: InitializePayload }
  | { type: 'process-chunk'; payload: ProcessChunkPayload }
  | { type: 'rate-limit-grant'; requestId: string }
  | { type: 'shutdown' };

/**
 * Initialize payload sent when worker starts
 * Contains org cache entries and import configuration
 */
export interface InitializePayload {
  /** Serialized organization cache entries from coordinator */
  cacheEntries: SerializedCacheEntry[];
  /** Import configuration options */
  options: WorkerImportOptions;
  /** Checkpoint directory path */
  checkpointDir: string;
}

/**
 * Process chunk payload sent when assigning work to a worker
 */
export interface ProcessChunkPayload {
  /** The chunk metadata to process */
  chunk: ChunkMetadata;
}

/**
 * Messages sent from Workers to Coordinator (main thread)
 */
export type WorkerMessage =
  | { type: 'ready' }
  | { type: 'rate-limit-request'; requestId: string }
  | { type: 'chunk-complete'; payload: ChunkCompletePayload }
  | { type: 'chunk-failed'; payload: ChunkFailedPayload };

/**
 * Payload sent when worker completes a chunk successfully
 */
export interface ChunkCompletePayload {
  /** ID of the completed chunk */
  chunkId: number;
  /** Summary statistics for the chunk */
  summary: ChunkSummary;
  /** New cache entries discovered by this worker */
  cacheUpdates: CacheUpdate[];
}

/**
 * Payload sent when worker fails to process a chunk
 */
export interface ChunkFailedPayload {
  /** ID of the failed chunk */
  chunkId: number;
  /** Error message describing the failure */
  error: string;
  /** Partial summary if any work was completed before failure */
  partialSummary?: Partial<ChunkSummary>;
}

/**
 * Cache update entry sent from worker to coordinator
 * Represents a newly discovered organization that should be merged into global cache
 */
export interface CacheUpdate {
  /** Cache key ("id:{orgId}" or "ext:{externalId}") */
  key: string;
  /** Organization ID */
  id: string;
  /** Organization external ID (if available) */
  externalId?: string;
  /** Organization name (if available) */
  name?: string;
}

/**
 * Import options passed to workers
 * Subset of main ImportOptions relevant for worker processing
 */
export interface WorkerImportOptions {
  /** Path to CSV file (workers will re-parse and skip to chunk range) */
  csvPath: string;
  /** Concurrency limit for API calls within worker */
  concurrency: number;
  /** Organization ID for single-org mode (null for multi-org mode) */
  orgId: string | null;
  /** Whether to require membership creation */
  requireMembership: boolean;
  /** Dry run mode (don't actually create users/memberships) */
  dryRun: boolean;
}

/**
 * Worker state tracking (used by coordinator)
 */
export interface WorkerState {
  /** Worker ID (index in worker pool) */
  workerId: number;
  /** Current status */
  status: 'initializing' | 'ready' | 'processing' | 'failed' | 'shutdown';
  /** Currently processing chunk ID (if status is 'processing') */
  currentChunkId?: number;
  /** Timestamp when worker started current chunk */
  chunkStartedAt?: number;
}

/**
 * Rate limit request tracking (used by coordinator)
 */
export interface RateLimitRequest {
  /** Unique request ID */
  requestId: string;
  /** Worker ID that made the request */
  workerId: number;
  /** Timestamp when request was made */
  requestedAt: number;
  /** Resolution callback */
  resolve: () => void;
  /** Timeout handle */
  timeout: NodeJS.Timeout;
}
