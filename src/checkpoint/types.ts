/**
 * Phase 3: Checkpoint state types for resumable imports
 */

export interface CheckpointState {
  jobId: string;
  csvPath: string;
  csvHash: string; // SHA-256 hash for validation
  createdAt: number; // timestamp (ms)
  updatedAt: number; // timestamp (ms)
  chunkSize: number;
  concurrency: number;
  totalRows: number; // Approximate count from pre-scan
  chunks: ChunkMetadata[];
  summary: CheckpointSummary;
  orgCache?: SerializedOrgCache;
  mode: 'single-org' | 'multi-org' | 'user-only';
  orgId?: string | null; // Single-org mode only
}

export interface ChunkMetadata {
  chunkId: number; // 0-indexed
  startRow: number; // 1-indexed (first data row = 1)
  endRow: number; // 1-indexed, inclusive
  status: 'pending' | 'completed' | 'failed';
  successes: number;
  failures: number;
  membershipsCreated: number;
  startedAt?: number; // timestamp (ms)
  completedAt?: number; // timestamp (ms)
  durationMs?: number;
}

export interface CheckpointSummary {
  total: number;
  successes: number;
  failures: number;
  membershipsCreated: number;
  startedAt: number;
  endedAt: number | null;
  warnings: string[];
}

export interface SerializedOrgCache {
  entries: SerializedCacheEntry[];
  stats: {
    hits: number;
    misses: number;
    evictions: number;
  };
}

export interface SerializedCacheEntry {
  key: string; // "id:{orgId}" or "ext:{externalId}"
  id: string;
  externalId?: string;
  name?: string;
}

export interface CreateCheckpointOptions {
  jobId: string;
  csvPath: string;
  csvHash: string;
  totalRows: number;
  chunkSize: number;
  concurrency: number;
  mode: 'single-org' | 'multi-org' | 'user-only';
  orgId?: string | null;
  checkpointDir?: string;
}

export interface ChunkSummary {
  successes: number;
  failures: number;
  membershipsCreated: number;
  durationMs: number;
}

export interface ProgressStats {
  completedChunks: number;
  totalChunks: number;
  completedRows: number;
  totalRows: number;
  percentComplete: number; // 0-100
  estimatedTimeRemainingMs: number | null; // null if not enough data
  averageChunkTimeMs: number | null;
}
