# Phase 5: Import Users

Import users from a CSV file into WorkOS User Management.

## Overview

The import tool handles the full lifecycle of user migration:

- **Planning Mode** — Analyze CSV and get recommendations before importing
- **Configuration Validation** — Catch errors before API calls
- **Interactive Confirmation** — Prompted before large imports (>10K rows)
- **Multi-org Support** — Automatic organization resolution and caching
- **Parallel Processing** — Worker pool for 4x throughput
- **Checkpointing** — Resume interrupted imports

## Quick Start

```bash
# Simple import
npx tsx bin/import-users.ts --csv users.csv

# Pre-flight check (no API calls)
npx tsx bin/import-users.ts --csv users.csv --plan

# Dry-run (validates CSV without creating users)
npx tsx bin/import-users.ts --csv users.csv --dry-run
```

## Planning Mode (`--plan`)

Analyze your CSV and generate a migration plan without making API calls.

```bash
npx tsx bin/import-users.ts --csv users.csv --plan
```

**Output:**
```
--- Migration Plan ---

CSV:              users.csv
Total rows:       50,000
Mode:             multi-org
Estimated time:   ~4 minutes

Configuration:
  Workers:        1
  Concurrency:    10 per worker
  Org resolution: per-row

Warnings:
  - Large import (50,000 rows) without checkpoint mode. Consider using --job-id for resumability.

Recommendations:
  - Use --job-id for imports >10K rows to enable resumability
  - Use --workers 3 for faster processing (4 CPUs available)

Plan is valid.
Ready to import 50,000 users.
```

**Exit codes:**
- `0` — Plan is valid
- `1` — Plan is invalid (see errors)

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

### Import Behavior

```bash
--concurrency <n>         # Concurrent API requests (default: 10)
--require-membership      # Require org membership for all users
--dry-run                 # Validate CSV without API calls
--quiet                   # Suppress per-row output
--errors-out <path>       # Save errors to file (CSV or JSONL)
```

### Planning & Automation

```bash
--plan                    # Analyze CSV and show migration plan (no import)
-y, --yes                 # Skip interactive prompts (for scripting/CI)
```

### Checkpoint & Resume

```bash
--job-id <id>             # Job ID for checkpoint mode
--resume [id]             # Resume from checkpoint
--chunk-size <n>          # Rows per chunk (default: 1000)
--checkpoint-dir <path>   # Checkpoint directory (default: .workos-checkpoints)
```

### Parallel Processing

```bash
--workers <n>             # Number of worker threads (requires --job-id)
```

### Role Assignment

```bash
--role-mapping <path>     # User-role mapping CSV (external_id -> role_slug)
--role-definitions <path> # Role definitions CSV (creates roles before import)
```

## Import Modes

The tool automatically detects the import mode:

### Single-Org Mode

**Triggered by:** `--org-id` or `--org-external-id` flag

All users are added to one organization.

```bash
npx tsx bin/import-users.ts --csv users.csv --org-id org_123
```

### Multi-Org Mode

**Triggered by:** CSV contains `org_id`, `org_external_id`, or `org_name` columns

Users are distributed across organizations based on CSV data.

```bash
npx tsx bin/import-users.ts --csv multi-org-users.csv
```

### User-Only Mode

**Triggered by:** No org columns in CSV, no org flags

Users are created without organization membership.

```bash
npx tsx bin/import-users.ts --csv users-only.csv
```

## Configuration Validation

Before importing, the tool validates your configuration:

1. **CSV File Access** — File must exist and be readable
2. **Organization Identifiers** — Only one of org-id/org-external-id
3. **Workers + Checkpoint** — Workers require --job-id or --resume
4. **Concurrency Range** — Must be >= 1
5. **Checkpoint Directory** — Must be writable

If validation fails, errors are displayed and the import does not start.

## Interactive Confirmation

For imports larger than 10,000 rows, the tool prompts for confirmation:

```
Large import detected: 50,000 rows
? Proceed with import? (Y/n)
```

Skip with `--yes`, `--quiet`, or `--dry-run`.

## Scripting and Automation

Use `--yes` to skip all interactive prompts:

```bash
npx tsx bin/import-users.ts \
  --csv users.csv \
  --org-id org_123 \
  --yes \
  --job-id ci-migration \
  --errors-out output/errors.jsonl
```

**Example: Automated migration script**

```bash
#!/bin/bash
set -e

# Validate CSV
npx tsx bin/validate-csv.ts --csv users.csv --auto-fix --fixed-csv users-fixed.csv

# Plan migration
npx tsx bin/import-users.ts --csv users-fixed.csv --org-id org_123 --plan

# Execute (non-interactive)
npx tsx bin/import-users.ts \
  --csv users-fixed.csv \
  --org-id org_123 \
  --job-id auto-migration-$(date +%s) \
  --errors-out output/errors.jsonl \
  --yes

# Analyze errors if any
if [ -f output/errors.jsonl ]; then
  npx tsx bin/analyze-errors.ts --errors output/errors.jsonl --retry-csv output/retry.csv
  if [ -f output/retry.csv ]; then
    npx tsx bin/import-users.ts --csv output/retry.csv --org-id org_123 --yes
  fi
fi
```

## Examples

### Simple Import

```bash
npx tsx bin/import-users.ts --csv users.csv
```

### Large Multi-Org with Workers

```bash
npx tsx bin/import-users.ts \
  --csv users.csv \
  --job-id large-migration \
  --workers 4 \
  --errors-out output/errors.jsonl
```

### Plan Then Execute

```bash
# Review the plan
npx tsx bin/import-users.ts --csv users.csv --org-id org_123 --plan

# Execute
npx tsx bin/import-users.ts --csv users.csv --org-id org_123
```

### Resume Failed Import

```bash
# Original (failed partway through)
npx tsx bin/import-users.ts --csv users.csv --job-id my-migration --org-id org_123

# Resume
npx tsx bin/import-users.ts --resume my-migration
```

### Import with Role Definitions

```bash
npx tsx bin/import-users.ts \
  --csv users.csv \
  --role-definitions role-definitions.csv \
  --role-mapping user-role-mapping.csv
```

## Programmatic Usage

The orchestrator modules can be used programmatically:

```typescript
import { MigrationOrchestrator } from './src/orchestrator/migrationOrchestrator.js';
import type { OrchestratorOptions } from './src/orchestrator/types.js';

const options: OrchestratorOptions = {
  csvPath: 'users.csv',
  orgId: 'org_123',
  quiet: true,
  yes: true
};

const orchestrator = new MigrationOrchestrator(options);
const plan = await orchestrator.plan();

if (!plan.valid) {
  console.error('Invalid plan:', plan.validation.errors);
  process.exit(1);
}

const result = await orchestrator.execute();
console.log(`${result.summary.successes} imported, ${result.summary.failures} failed`);
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success (plan valid or import completed) |
| 1 | Failure (plan invalid or import had errors) |
| 2 | Fatal error (file not found, invalid options) |

## Related Documentation

- [Wizard Guide](../getting-started/WIZARD.md) — Interactive step-by-step migration
- [Quick Start](../getting-started/QUICK-START.md) — Get started fast
- [Worker Pool](../advanced/WORKER-POOL.md) — Parallel processing
- [Chunking & Resumability](../advanced/CHUNKING-RESUMABILITY.md) — Checkpointing
- [Role Mapping](../guides/ROLE-MAPPING.md) — Role and permission migration
- [Troubleshooting](../guides/TROUBLESHOOTING.md) — Common errors and solutions
