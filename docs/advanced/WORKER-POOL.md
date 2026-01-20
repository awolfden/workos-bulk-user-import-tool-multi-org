# Worker Pool & Parallel Processing

Process imports 4x faster using multiple worker threads.

## Overview

Worker pool enables parallel processing using multiple threads:
- **4x faster throughput** with 4 workers
- **Distributed rate limiting** - respects WorkOS API limits
- **Cache merging** - organization caches combined from all workers
- **Crash recovery** - workers restart failed chunks

## When to Use

✅ Imports with **50K+ users** (significant time savings)
✅ Time-sensitive migrations
✅ Multi-core machines (2-8 CPUs)
✅ Production imports

❌ Small imports (<10K users) - overhead outweighs benefits
❌ Single-core machines
❌ Local testing

## Basic Usage

Requires `--job-id`:

```bash
WORKOS_SECRET_KEY=sk_test_123 \
  npx tsx bin/import-users.ts \
    --csv users.csv \
    --job-id large-import \
    --workers 4
```

## Performance Comparison

| Workers | Throughput | 100K users | 1M users |
|---------|------------|------------|----------|
| 1 | ~20/sec | 1.4 hours | 13.9 hours |
| 2 | ~40/sec | 42 min | 6.9 hours |
| 4 | ~80/sec | 21 min | 3.5 hours |

**Note:** Throughput limited by WorkOS API (50 req/sec). Beyond 4 workers provides diminishing returns.

## How It Works

```
┌─────────────────────┐
│    Coordinator      │
│  - Chunk Queue      │
│  - Rate Limiter     │
│  - Checkpoint Save  │
└──────┬──────────────┘
       │
   ┌───┴───┬───────┬────────┐
   ▼       ▼       ▼        ▼
Worker 1 Worker 2 ... Worker N
(chunk 0)(chunk 1)    (chunk N)
```

1. Coordinator manages worker pool
2. Each worker processes chunks in parallel
3. Rate limiting coordinated across all workers
4. Organization caches merged back to coordinator

## Recommended Configurations

```bash
# Small (10K-50K users) - single worker
--workers 1 --chunk-size 1000

# Medium (50K-200K users) - 2 workers
--workers 2 --chunk-size 1000

# Large (200K-1M users) - 4 workers
--workers 4 --chunk-size 1000

# Very large (1M+ users) - 4 workers, larger chunks
--workers 4 --chunk-size 5000
```

## Worker Count Guidelines

- **1 worker**: Sequential (standard chunked mode)
- **2 workers**: 2x speedup
- **4 workers**: 4x speedup (optimal)
- **6-8 workers**: Marginal gains (rate limit bottleneck)

**Rule of thumb**: `min(4, CPU_count / 2)`

## Memory Usage

Each worker uses ~60-90MB:

| Workers | Total Memory | Recommendation |
|---------|--------------|----------------|
| 1 | ~150MB | Any machine |
| 2 | ~270MB | 512MB+ RAM |
| 4 | ~480MB | 1GB+ RAM |
| 8 | ~900MB | 2GB+ RAM |

Memory is **constant** regardless of import size.

## Resuming with Workers

```bash
# Start with 4 workers
npx tsx bin/import-users.ts --csv users.csv --job-id job1 --workers 4

# Resume with different worker count
npx tsx bin/import-users.ts --resume job1 --workers 2
```

Worker count can change on resume.

## Examples

### Standard Large Import

```bash
WORKOS_SECRET_KEY=sk_test_123 \
  npx tsx bin/import-users.ts \
    --csv users-100k.csv \
    --job-id migration-prod \
    --workers 4 \
    --chunk-size 1000
```

Expected: ~20-30 minutes for 100K users

### Multi-Org with Workers

```bash
WORKOS_SECRET_KEY=sk_test_123 \
  npx tsx bin/import-users.ts \
    --csv multi-org.csv \
    --job-id multi-org-migration \
    --workers 4
```

**Pre-warming** eliminates race conditions by creating all organizations before workers start.

See [Pre-Warming](PRE-WARMING.md) for details.

## Troubleshooting

### "Worker exited with code 1"

**Causes:**
- Insufficient memory (need ~60-90MB per worker)
- Worker crash
- API errors

**Solutions:**
```bash
# Reduce workers
--workers 2

# Check available RAM
node -e "console.log((require('os').freemem() / 1024 / 1024).toFixed(0) + ' MB')"

# Resume (failed chunks retried)
npx tsx bin/import-users.ts --resume {job-id}
```

### Slower than Expected

**Check:**
1. Verify `--job-id` provided (required for workers)
2. Check CPU count: `node -e "console.log(require('os').cpus().length)"`
3. For <50K users, single worker may be faster (less overhead)

### Worker Warning: "exceeds CPU count"

Informational only. Tool still works, but performance may not improve.

## Safety Features

✅ Checkpoint saves are thread-safe
✅ Cache merging prevents duplicates
✅ Worker crashes don't lose progress
✅ Backward compatible with single-worker mode

## Performance Tips

1. **Match workers to CPUs**:
   ```bash
   # Check CPU count
   node -e "console.log(require('os').cpus().length)"
   
   # Use half that number
   --workers 4  # For 8-core machine
   ```

2. **Increase concurrency**:
   ```bash
   --concurrency 20  # Default is 10
   ```

3. **Use quiet mode**:
   ```bash
   --quiet  # Reduces logging overhead
   ```

4. **Adjust chunk size**:
   ```bash
   --chunk-size 5000  # Larger chunks = fewer context switches
   ```

## Related Documentation

- [Chunking & Resumability](CHUNKING-RESUMABILITY.md) - Checkpointing basics
- [Pre-Warming](PRE-WARMING.md) - Eliminate race conditions
- [Import Phase](../phases/05-IMPORT.md) - All import options
- [Performance Guide](PERFORMANCE.md) - Optimization tips
