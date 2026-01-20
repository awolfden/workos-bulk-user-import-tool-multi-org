# Chunking & Resumability

Large-scale imports with checkpoint/resume capability.

## Overview

Chunked mode provides:
- **Constant memory**: ~100MB regardless of CSV size
- **Crash recovery**: Resume from last completed chunk
- **Progress tracking**: Real-time ETA
- **Cache persistence**: Organization cache survives restarts

## When to Use

✅ Imports with 10,000+ users
✅ Long-running imports (>10 minutes)
✅ Unreliable networks
✅ Production migrations requiring recoverability

❌ Small imports (<5K users)
❌ Quick one-off imports
❌ When simplicity preferred

## Basic Usage

Enable with `--job-id`:

```bash
WORKOS_SECRET_KEY=sk_test_123 \
  npx tsx bin/import-users.ts \
    --csv large-import.csv \
    --job-id prod-migration-2024-01-15
```

## How It Works

```
CSV File (100K rows)
    ↓
Split into Chunks (1000 rows each)
    ↓
Process → Checkpoint → Save
    ↓
Resume on failure
```

## Configuration

### Chunk Size

```bash
# Default: 1000 rows
--chunk-size 1000

# Larger chunks (faster, more memory)
--chunk-size 5000

# Smaller chunks (slower, safer)
--chunk-size 500
```

**Trade-offs:**

| Size | Checkpoints | Lost Work | Memory | Use Case |
|------|-------------|-----------|---------|----------|
| 500 | Frequent | <30s | Lower | Unstable networks |
| 1000 | Balanced | ~1min | Medium | Most cases |
| 5000 | Less | ~5min | Higher | Stable networks |

### Checkpoint Directory

```bash
# Default: .workos-checkpoints/
--checkpoint-dir /path/to/checkpoints
```

## Resuming

```bash
# Resume specific job
npx tsx bin/import-users.ts --resume prod-migration-2024-01-15

# Resume most recent job
npx tsx bin/import-users.ts --resume
```

**Resume behavior:**
- Loads checkpoint
- Validates CSV unchanged (SHA-256 hash)
- Restores organization cache
- Continues from next pending chunk

## Progress Tracking

Real-time progress after each chunk:

```
Progress: 15/100 chunks (15%) - ETA: 45m 20s
Progress: 16/100 chunks (16%) - ETA: 44m 10s
```

ETA becomes accurate after 5-10 chunks.

## Checkpoint Structure

```
.workos-checkpoints/
└── prod-migration-2024-01-15/
    ├── checkpoint.json    # Job state
    └── errors.jsonl       # Streamed errors
```

## Examples

### Large Multi-Org Import

```bash
WORKOS_SECRET_KEY=sk_test_123 \
  npx tsx bin/import-users.ts \
    --csv migration-100k.csv \
    --job-id migration-acme \
    --chunk-size 1000 \
    --concurrency 20 \
    --quiet
```

### Resume After Crash

```bash
# Interrupted at chunk 45/100
npx tsx bin/import-users.ts --resume migration-acme

# Output:
# Resuming job: migration-acme
# Checkpoint loaded: 45/100 chunks completed (45%)
# Progress: 46/100 chunks (46%) - ETA: 28m 40s
```

## Memory Guarantees

| CSV Size | Memory (Chunked) | Memory (Streaming) |
|----------|------------------|-------------------|
| 10K rows | ~75 MB | ~50 MB |
| 100K rows | ~100 MB | ~75 MB |
| 500K rows | ~100 MB | ~150 MB |
| 1M+ rows | ~100 MB | ~300 MB+ |

Chunked mode maintains constant memory by processing one chunk at a time.

## Best Practices

1. **Use descriptive job IDs**:
   ```bash
   # Good
   --job-id migration-acme-corp-2024-01-15
   
   # Avoid
   --job-id job1
   ```

2. **Monitor progress**:
   ```bash
   tail -f .workos-checkpoints/{job-id}/errors.jsonl | jq .
   ```

3. **Test with dry-run first**:
   ```bash
   npx tsx bin/import-users.ts --csv large.csv --dry-run
   ```

4. **Clean up old checkpoints**:
   ```bash
   rm -rf .workos-checkpoints/old-job-id
   ```

## Related Documentation

- [Worker Pool](WORKER-POOL.md) - Parallel processing
- [Import Phase](../phases/05-IMPORT.md) - All import options
