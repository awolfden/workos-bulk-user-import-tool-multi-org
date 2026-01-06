# Phase 5: Import Orchestrator

High-level migration workflow wrapper with planning, validation, and interactive guidance.

## Overview

The Import Orchestrator provides a streamlined interface for WorkOS user migrations with:

- **Planning Mode**: Dry-run analysis before import
- **Interactive Prompts**: Smart defaults and confirmations
- **Configuration Validation**: Catch errors before API calls
- **Duration Estimates**: Know how long migrations will take
- **Optimization Recommendations**: Automatic suggestions for better performance

## When to Use

Use the orchestrator instead of direct import when you want:

1. **Pre-flight validation** - Verify configuration before import
2. **Duration estimates** - Know how long a migration will take
3. **Interactive guidance** - Prompted for missing configuration
4. **Optimization tips** - Recommendations for large imports
5. **Better error messages** - Clear validation feedback

For simple, well-configured imports, you can still use `bin/import-users.ts` directly.

## Installation

The orchestrator is included in the toolkit:

```bash
npx tsx bin/orchestrate-migration.ts --help
```

## Two Modes

### Planning Mode (`--plan`)

Generate a migration plan without making API calls.

```bash
npx tsx bin/orchestrate-migration.ts \
  --csv users.csv \
  --plan
```

**Output:**
```
╔════════════════════════════════════════════════════╗
║              MIGRATION PLAN                        ║
╚════════════════════════════════════════════════════╝

CSV:              users.csv
Total rows:       50,000
Mode:             multi-org
Estimated time:   ~4 minutes

Configuration:
  Workers:        1
  Concurrency:    10 per worker
  Chunks:         undefined
  Org resolution: per-row

⚠️  Warnings:
  • Workers set to 4 but checkpoint mode not enabled. Workers require --job-id or --resume.

Recommendations:
  • Use --job-id for imports >10K rows to enable resumability
  • Use --workers 3 for faster processing (4 CPUs available)
  • Add --errors-out errors.jsonl to capture failures for retry

✓ Plan is valid

Ready to import 50,000 users
To execute: npx tsx bin/orchestrate-migration.ts --csv users.csv
```

**Exit Codes:**
- `0`: Plan is valid
- `1`: Plan is invalid (see errors)
- `2`: Fatal error (file not found, etc.)

### Execution Mode (default)

Run the actual import with interactive guidance.

```bash
npx tsx bin/orchestrate-migration.ts \
  --csv users.csv \
  --org-id org_123
```

**Interactive Features:**

1. **Missing Configuration Prompt** (single-org mode only):
   ```
   ⚠️  Single-org mode requires an organization identifier
   ? Enter organization ID: ›
   ```

2. **Large Import Confirmation** (>10K rows):
   ```
   ⚠️  Large import detected: 50,000 rows
   Estimated duration: ~4 minutes

   ? Proceed with import? › (Y/n)
   ```

Both prompts can be skipped with `--yes` flag (see Scripting section).

## CLI Reference

### Required Options

```bash
--csv <path>              # Path to CSV file
```

### Organization Options (Single-Org Mode)

Choose ONE of the following:

```bash
--org-id <id>             # WorkOS organization ID
--org-external-id <id>    # Organization external ID
--org-name <name>         # Organization name (with --create-org-if-missing)

--create-org-if-missing   # Create org if not found (requires --org-name)
```

### Import Behavior Options

```bash
--concurrency <number>    # Concurrent API requests (default: 10)
--require-membership      # Require org membership for all users
--dry-run                 # Validate CSV without API calls
--quiet                   # Suppress progress output
--errors-out <path>       # Output path for errors.jsonl
```

### Checkpoint Options

```bash
--job-id <id>             # Job ID for checkpoint mode
--resume [id]             # Resume from checkpoint (optionally specify job ID)
--chunk-size <number>     # Rows per checkpoint chunk (default: 1000)
--checkpoint-dir <path>   # Checkpoint directory (default: .workos-checkpoints)
```

### Worker Options

```bash
--workers <number>        # Number of worker processes (requires checkpoint mode)
```

### Orchestrator Options

```bash
--plan                    # Generate migration plan only (dry-run analysis)
--yes / -y                # Skip all interactive prompts (for scripting/MCP)
```

## Import Modes

The orchestrator automatically detects the import mode:

### Single-Org Mode

**Triggered by:** `--org-id` or `--org-external-id` or `--org-name` flag

**Behavior:**
- Organization resolved once before import (upfront resolution)
- All users added to the same organization
- Interactive prompt if org identifier missing (unless `--yes`)

**Example:**
```bash
npx tsx bin/orchestrate-migration.ts \
  --csv users.csv \
  --org-id org_123
```

### Multi-Org Mode

**Triggered by:** CSV contains `org_id`, `org_external_id`, or `org_name` column

**Behavior:**
- Organization resolved per-row with caching
- Users can belong to different organizations
- Multiple memberships supported

**Example CSV:**
```csv
email,first_name,last_name,org_id
alice@example.com,Alice,Smith,org_123
bob@example.com,Bob,Jones,org_456
```

### User-Only Mode

**Triggered by:** No org columns in CSV, no org flags

**Behavior:**
- Users created without organization membership
- No organization resolution needed

**Example CSV:**
```csv
email,first_name,last_name
alice@example.com,Alice,Smith
bob@example.com,Bob,Jones
```

## Configuration Validation

The orchestrator validates configuration before import:

### Validation Rules

1. **CSV File Access** - File must exist and be readable
2. **Organization Identifiers** - Only one of org-id/org-external-id/org-name
3. **Workers + Checkpoint** - Workers require --job-id or --resume
4. **Concurrency Range** - Must be 1-100
5. **Chunk Size Range** - Must be 100-10000 if specified
6. **Resume Option** - Must be boolean or string

### Example: Invalid Configuration

```bash
npx tsx bin/orchestrate-migration.ts \
  --csv users.csv \
  --org-id org_123 \
  --org-external-id org_ext_456 \
  --plan
```

**Output:**
```
❌ Configuration errors:
  • Cannot specify both org-id and org-external-id
```

## Duration Estimation

The orchestrator estimates import duration based on:

- **Row count** - Number of users to import
- **Concurrency** - Parallel API requests per worker
- **Workers** - Number of worker processes
- **Base rate** - ~20 users/sec at concurrency 10 with 1 worker

**Formula:**
```
effectiveRate = 20 * (concurrency / 10) * workers
estimatedSeconds = totalRows / effectiveRate
```

**Example Estimates:**

| Rows | Concurrency | Workers | Estimate |
|------|-------------|---------|----------|
| 1,000 | 10 | 1 | ~50 seconds |
| 10,000 | 10 | 1 | ~8 minutes |
| 50,000 | 10 | 4 | ~10 minutes |
| 100,000 | 20 | 4 | ~10 minutes |

## Optimization Recommendations

The orchestrator provides automatic recommendations:

### Checkpoint Recommendation

**Trigger:** >10K rows without --job-id or --resume

**Recommendation:**
```
Use --job-id for imports >10K rows to enable resumability
```

**Action:**
```bash
npx tsx bin/orchestrate-migration.ts \
  --csv users.csv \
  --job-id my-migration \
  --org-id org_123
```

### Worker Recommendation

**Trigger:** >50K rows with 1 worker

**Recommendation:**
```
Use --workers 3 for faster processing (4 CPUs available)
```

**Action:**
```bash
npx tsx bin/orchestrate-migration.ts \
  --csv users.csv \
  --job-id my-migration \
  --workers 3 \
  --org-id org_123
```

### Errors Output Recommendation

**Trigger:** No --errors-out specified

**Recommendation:**
```
Add --errors-out errors.jsonl to capture failures for retry
```

**Action:**
```bash
npx tsx bin/orchestrate-migration.ts \
  --csv users.csv \
  --errors-out errors.jsonl \
  --org-id org_123
```

### Multi-Org Caching Info

**Trigger:** Multi-org mode detected

**Recommendation:**
```
Multi-org mode uses organization caching for performance
```

**Info:** LRU cache with 10K capacity and request coalescing.

### Concurrency Recommendation

**Trigger:** >100K rows with default concurrency

**Recommendation:**
```
Consider increasing --concurrency for large imports (try 20-50)
```

## Scripting and Automation

For non-interactive use (CI/CD, MCP, scripts), use `--yes` flag:

```bash
npx tsx bin/orchestrate-migration.ts \
  --csv users.csv \
  --org-id org_123 \
  --yes
```

**Behavior with `--yes`:**
- No prompt for missing org-id (fails if missing)
- No confirmation for large imports
- Suitable for programmatic use

**Example: Automated Migration**

```bash
#!/bin/bash
set -e

# Validate CSV
npx tsx bin/validate-csv.ts --csv users.csv --auto-fix --fixed-csv users-fixed.csv

# Plan migration
npx tsx bin/orchestrate-migration.ts --csv users-fixed.csv --org-id org_123 --plan

# Execute migration (non-interactive)
npx tsx bin/orchestrate-migration.ts \
  --csv users-fixed.csv \
  --org-id org_123 \
  --job-id auto-migration-$(date +%s) \
  --errors-out errors.jsonl \
  --yes

# Analyze errors if any
if [ -f errors.jsonl ]; then
  npx tsx bin/analyze-errors.ts --errors errors.jsonl --retry-csv retry.csv

  # Retry failed imports
  if [ -f retry.csv ]; then
    npx tsx bin/orchestrate-migration.ts --csv retry.csv --org-id org_123 --yes
  fi
fi
```

## Examples

### Example 1: Small Single-Org Import

```bash
npx tsx bin/orchestrate-migration.ts \
  --csv users.csv \
  --org-id org_123
```

**Behavior:**
- Interactive (no prompts for small import)
- Single-org mode
- Default concurrency (10)
- No checkpoint

### Example 2: Large Multi-Org Import with Workers

```bash
npx tsx bin/orchestrate-migration.ts \
  --csv users.csv \
  --job-id large-migration \
  --workers 4 \
  --concurrency 20 \
  --errors-out errors.jsonl
```

**Behavior:**
- Interactive (confirmation prompt for large import)
- Multi-org mode (detected from CSV)
- 4 workers, 20 concurrency per worker
- Checkpoint enabled
- Errors logged to errors.jsonl

### Example 3: Planning a Migration

```bash
# First, plan the migration
npx tsx bin/orchestrate-migration.ts \
  --csv users.csv \
  --org-id org_123 \
  --plan

# Review the plan output, then execute
npx tsx bin/orchestrate-migration.ts \
  --csv users.csv \
  --org-id org_123
```

### Example 4: Resume Failed Migration

```bash
# Original migration (failed partway through)
npx tsx bin/orchestrate-migration.ts \
  --csv users.csv \
  --job-id my-migration \
  --org-id org_123

# Resume from checkpoint
npx tsx bin/orchestrate-migration.ts \
  --csv users.csv \
  --resume my-migration
```

### Example 5: Non-Interactive Migration

```bash
npx tsx bin/orchestrate-migration.ts \
  --csv users.csv \
  --org-id org_123 \
  --yes \
  --job-id ci-migration-$(date +%s) \
  --errors-out errors.jsonl
```

## Integration with Other Tools

### Pre-Migration: Validation

```bash
# Validate before orchestrating
npx tsx bin/validate-csv.ts --csv users.csv --auto-fix --fixed-csv users-fixed.csv

# Plan migration with fixed CSV
npx tsx bin/orchestrate-migration.ts --csv users-fixed.csv --plan
```

### Post-Migration: Error Analysis

```bash
# Import with error logging
npx tsx bin/orchestrate-migration.ts \
  --csv users.csv \
  --org-id org_123 \
  --errors-out errors.jsonl

# Analyze errors
npx tsx bin/analyze-errors.ts \
  --errors errors.jsonl \
  --retry-csv retry.csv

# Retry failed imports
npx tsx bin/orchestrate-migration.ts \
  --csv retry.csv \
  --org-id org_123
```

## Troubleshooting

### Issue: "Migration plan is invalid"

**Cause:** Configuration validation failed

**Solution:** Run with `--plan` to see specific errors:
```bash
npx tsx bin/orchestrate-migration.ts --csv users.csv --plan
```

### Issue: "Workers set but checkpoint mode not enabled"

**Cause:** `--workers` requires `--job-id` or `--resume`

**Solution:** Add checkpoint option:
```bash
npx tsx bin/orchestrate-migration.ts \
  --csv users.csv \
  --job-id my-migration \
  --workers 4
```

### Issue: "Cannot specify both org-id and org-external-id"

**Cause:** Multiple organization identifiers provided

**Solution:** Choose one:
```bash
# Option 1: Use org-id
npx tsx bin/orchestrate-migration.ts --csv users.csv --org-id org_123

# Option 2: Use org-external-id
npx tsx bin/orchestrate-migration.ts --csv users.csv --org-external-id ext_456
```

### Issue: Import takes longer than estimated

**Cause:** Estimates are conservative and don't account for network latency

**Solution:** Increase concurrency or workers:
```bash
npx tsx bin/orchestrate-migration.ts \
  --csv users.csv \
  --org-id org_123 \
  --concurrency 20 \
  --workers 4
```

### Issue: Prompt appears in CI/CD pipeline

**Cause:** Interactive prompts enabled by default

**Solution:** Use `--yes` flag:
```bash
npx tsx bin/orchestrate-migration.ts --csv users.csv --org-id org_123 --yes
```

## Programmatic Usage (for MCP/Phase 6)

The orchestrator can be used programmatically:

```typescript
import { MigrationOrchestrator } from './src/orchestrator/migrationOrchestrator.js';
import type { OrchestratorOptions } from './src/orchestrator/types.js';

// Generate plan
const options: OrchestratorOptions = {
  csvPath: 'users.csv',
  orgId: 'org_123',
  quiet: true,
  yes: true  // Skip prompts
};

const orchestrator = new MigrationOrchestrator(options);
const plan = await orchestrator.plan();

if (!plan.valid) {
  console.error('Invalid plan:', plan.validation.errors);
  process.exit(1);
}

// Execute import
const result = await orchestrator.execute();

console.log(`Import complete: ${result.summary.successes} successes, ${result.summary.failures} failures`);
console.log(`Duration: ${result.duration}ms`);
```

## Performance

### Planning Mode

| Rows | Time | Memory |
|------|------|--------|
| 10K | <2s | <100MB |
| 100K | <5s | <100MB |
| 1M | <10s | <100MB |

### Execution Mode

Identical to direct import tool performance (minimal overhead).

## Exit Codes

| Code | Meaning | Planning Mode | Execution Mode |
|------|---------|---------------|----------------|
| 0 | Success | Plan valid | Import succeeded |
| 1 | Failure | Plan invalid | Import failed |
| 2 | Fatal error | File not found, invalid options | Fatal error |

## Next Steps

After successful import:

1. **Review summary** - Check successes/failures count
2. **Analyze errors** - Use error analyzer if failures occurred
3. **Retry failures** - Use generated retry CSV
4. **Resume checkpoint** - Use --resume for interrupted migrations

## Related Documentation

- [Phase 1: Auth0 Exporter](PHASE1-EXPORT.md) - Export from Auth0
- [Phase 2: Data Validator](PHASE2-VALIDATE.md) - Validate CSV before import
- [Phase 3: Field Mapper](PHASE3-MAP.md) - Transform CSV formats
- [Phase 4: Error Analyzer](PHASE4-ANALYZE.md) - Analyze and retry failures
- [Phase 6: MCP Server](PHASE6-MCP.md) - Conversational interface (future)

## Support

For issues or questions:
- Review this documentation
- Check troubleshooting section
- Review configuration validation errors
- Test with `--plan` flag first
