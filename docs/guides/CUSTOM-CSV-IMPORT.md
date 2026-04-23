# Custom CSV Import Guide

Import users from any CSV file into WorkOS.

## Prerequisites

- **Node.js 18+** installed
- **WorkOS Secret Key** (found in your WorkOS Dashboard under API Keys)
- A CSV file with at least an `email` column (see [CSV Format Reference](CSV-FORMAT.md) for all supported columns)

Store your key in a `.env` file or pass it inline:

```bash
# Option A: .env file (recommended for repeated use)
echo 'WORKOS_SECRET_KEY=sk_test_123' > .env

# Option B: Inline (one-off imports)
WORKOS_SECRET_KEY=sk_test_123 npx workos-migrate import --csv users.csv
```

**Important**: Never share or hardcode your Secret Key. Use environment variables or a `.env` file.

## Quick Start

The simplest possible import -- just provide a CSV with an `email` column:

```bash
npx workos-migrate import --csv users.csv
```

That is all you need. The tool will read the CSV, create users in WorkOS, and report a summary when finished. For a guided, interactive experience, see the [Wizard Guide](WIZARD.md).

## Import Modes

The tool automatically detects the appropriate mode based on your CSV columns and CLI flags.

### User-Only Mode

Import users without organization memberships. This is the default when no organization columns or flags are present.

```bash
npx workos-migrate import --csv users.csv
```

Example CSV:

```csv
email,first_name,last_name,email_verified
alice@example.com,Alice,Smith,true
bob@example.com,Bob,Jones,true
```

### Single-Organization Mode

Add all imported users to one organization. Triggered by passing an `--org-id` or `--org-external-id` flag.

**By WorkOS organization ID:**

```bash
npx workos-migrate import --csv users.csv --org-id org_123
```

**By external ID (with auto-creation):**

```bash
npx workos-migrate import \
  --csv users.csv \
  --org-external-id acme-corp \
  --org-name "Acme Corp" \
  --create-org-if-missing
```

| Flag | Description |
|------|-------------|
| `--org-id <id>` | WorkOS organization ID (direct, no API lookup) |
| `--org-external-id <id>` | Your external organization identifier (cached API lookup) |
| `--org-name <name>` | Organization display name (used with `--create-org-if-missing`) |
| `--create-org-if-missing` | Create the organization if it does not exist (requires `--org-name`) |

### Multi-Organization Mode

Distribute users across different organizations by including `org_id`, `org_external_id`, or `org_name` columns in your CSV. The tool auto-detects multi-org mode when these columns are present.

```bash
npx workos-migrate import --csv multi-org-users.csv
```

Example CSV:

```csv
email,first_name,last_name,org_external_id,org_name
alice@acme.com,Alice,Smith,acme-corp,Acme Corporation
bob@acme.com,Bob,Jones,acme-corp,Acme Corporation
charlie@beta.com,Charlie,Brown,beta-inc,Beta Inc
```

**Key behaviors:**

- **Auto-detection**: The tool inspects CSV headers and enables multi-org mode automatically.
- **Organization resolution**: For each row, the tool looks up or creates the organization using cached API calls.
- **Pre-warming**: When using workers, all organizations are resolved before parallel processing begins to eliminate race conditions.
- **Multi-membership**: A user can appear in multiple rows with different organizations to create multiple memberships. The user is created once; subsequent rows add memberships only.

**Multi-membership example:**

```csv
email,first_name,last_name,external_id,org_external_id,org_name
alice@example.com,Alice,Smith,user-001,acme-corp,Acme Corporation
alice@example.com,Alice,Smith,user-001,beta-inc,Beta Inc
alice@example.com,Alice,Smith,user-001,gamma-llc,Gamma LLC
```

Result: 1 user created with 3 organization memberships.

**Organization column rules:**

- Use **`org_id`** for direct WorkOS organization IDs (fastest, no lookup needed).
- Use **`org_external_id`** for your own external identifiers (cached API lookup).
- Use **`org_name`** alongside `org_external_id` to auto-create organizations that do not exist.
- A row cannot have both `org_id` and `org_external_id` -- they are mutually exclusive.

**Mode conflict**: If CLI flags (`--org-id` or `--org-external-id`) and CSV org columns are both present, CLI flags take priority and single-org mode is used. A warning is displayed.

## Step-by-Step

### Step 1: Validate Your CSV

Always validate your CSV before importing. The validator catches errors early and can auto-fix common formatting issues.

```bash
npx workos-migrate validate --csv users.csv --auto-fix --fixed-csv users-fixed.csv
```

**What validation checks (11 rules across 3 categories):**

**Header rules:**
- `required-email-column` -- CSV must have an `email` column
- `unknown-columns` -- warns about unrecognized column names
- `mode-detection` -- identifies import mode (user-only, single-org, multi-org)

**Row rules:**
- `required-email` -- every row must have a non-empty email
- `email-format` -- email must contain an `@` symbol
- `email-whitespace` -- warns about leading/trailing spaces (auto-fixable)
- `metadata-json` -- metadata field must be valid JSON
- `metadata-arrays-objects` -- metadata values must be primitives; arrays/objects are converted to JSON strings (auto-fixable)
- `org-id-conflict` -- row cannot have both `org_id` and `org_external_id`
- `boolean-format` -- boolean fields normalized to `true`/`false` (auto-fixable)
- `password-hash-complete` -- `password_hash` requires `password_hash_type`

**Duplicate rules:**
- `duplicate-email` -- detects duplicate email addresses (case-insensitive)
- `duplicate-external-id` -- detects duplicate `external_id` values

**Auto-fix capabilities:**

The `--auto-fix` flag automatically corrects common formatting issues without modifying your original file:

| Issue | Before | After |
|-------|--------|-------|
| Email whitespace | `" alice@example.com "` | `"alice@example.com"` |
| Boolean values | `"yes"`, `"1"`, `"Y"` | `"true"` |
| Metadata arrays/objects | `{"perms":["read","write"]}` | `{"perms":"[\"read\",\"write\"]"}` |

**Full validation options:**

```bash
npx workos-migrate validate \
  --csv users.csv \
  --auto-fix \
  --fixed-csv users-fixed.csv \
  --report validation-report.json \
  --dedupe \
  --deduped-csv users-deduped.csv
```

| Option | Description |
|--------|-------------|
| `--csv <path>` | CSV file to validate (required) |
| `--auto-fix` | Auto-fix common formatting issues |
| `--fixed-csv <path>` | Output path for the fixed CSV (requires `--auto-fix`) |
| `--report <path>` | JSON report output path (default: `validation-report.json`) |
| `--dedupe` | Merge rows with duplicate email addresses |
| `--deduped-csv <path>` | Output path for the deduplicated CSV (requires `--dedupe`) |
| `--quiet` | Suppress progress output |

### Step 2: Preview the Migration Plan

Run the import command with `--plan` to analyze your CSV and see a migration plan without making any API calls:

```bash
npx workos-migrate import --csv users.csv --plan
```

**Example output:**

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

The plan validates your configuration and checks for:
- CSV file accessibility
- Organization identifier consistency
- Worker and checkpoint configuration
- Concurrency settings

Exit code `0` means the plan is valid; `1` means there are issues to address.

### Step 3: Import

Run the actual import:

```bash
npx workos-migrate import --csv users.csv
```

For each CSV row, the tool:
1. Validates required fields (email, etc.)
2. Parses metadata JSON (if present)
3. Creates the user in WorkOS
4. Creates organization membership (if org mode)
5. Retries rate-limited requests (HTTP 429)

**Save errors for later analysis:**

```bash
npx workos-migrate import \
  --csv users.csv \
  --org-id org_123 \
  --errors-out output/errors.jsonl
```

**Example summary output:**

```
+-----------------------------------------+
| SUMMARY                                 |
| Status: Success                         |
| Users imported: 100/100                 |
| Duration: 12.3 s                        |
| Warnings: 0                             |
| Errors: 0                               |
+-----------------------------------------+
```

### Step 4: Handle Errors (if any)

If the import produced errors, analyze them:

```bash
npx workos-migrate analyze --errors output/errors.jsonl
```

Generate a retry CSV for transient failures:

```bash
npx workos-migrate analyze --errors output/errors.jsonl --retry-csv output/retry.csv
```

Then re-import just the failed rows:

```bash
npx workos-migrate import --csv output/retry.csv --org-id org_123 --yes
```

For detailed error resolution guidance, see the [Troubleshooting Guide](TROUBLESHOOTING.md).

## Field Mapping

If your CSV comes from another identity provider (Auth0, Okta, etc.) and uses different column names, use the field mapper to transform it to WorkOS format.

```bash
npx workos-migrate map-fields \
  --input auth0-export.csv \
  --output workos-ready.csv \
  --profile auth0
```

### Built-in Profiles

List available profiles:

```bash
npx workos-migrate map-fields --list-profiles
```

Currently available:
- **`auth0`** -- maps Auth0 user exports (`user_id`, `given_name`, `family_name`, `user_metadata`, `app_metadata`, etc.)

### Custom JSON Profiles

Create a JSON file to map columns from any provider. See `examples/common/custom-profile.json` for a template:

```json
{
  "name": "custom",
  "description": "Custom provider to WorkOS format",
  "mappings": [
    {
      "sourceField": "email",
      "targetField": "email",
      "transformer": "lowercase_trim"
    },
    {
      "sourceField": "firstName",
      "targetField": "first_name",
      "transformer": "trim"
    },
    {
      "sourceField": "emailVerified",
      "targetField": "email_verified",
      "transformer": "to_boolean"
    }
  ],
  "metadataMapping": {
    "targetField": "metadata",
    "sourceFields": ["customMetadata"],
    "fieldPrefix": "custom_",
    "staticMetadata": {
      "_provider": "custom"
    }
  }
}
```

Use it:

```bash
npx workos-migrate map-fields \
  --input provider-export.csv \
  --output workos-ready.csv \
  --profile ./my-custom-profile.json
```

### Available Transformers

| Transformer | Description | Example |
|-------------|-------------|---------|
| `lowercase_trim` | Lowercase and trim whitespace | `" ALICE@EXAMPLE.COM "` -> `"alice@example.com"` |
| `trim` | Remove leading/trailing whitespace | `" Alice "` -> `"Alice"` |
| `uppercase` | Convert to uppercase | `"hello"` -> `"HELLO"` |
| `to_boolean` | Normalize to `true`/`false` | `"yes"` -> `"true"` |
| `to_json_string` | Convert objects to JSON strings | `{dept: "Eng"}` -> `'{"dept":"Eng"}'` |
| `identity` | Pass through unchanged | `"hello"` -> `"hello"` |

### Transform and Validate in One Step

```bash
npx workos-migrate map-fields \
  --input auth0-export.csv \
  --output workos-ready.csv \
  --profile auth0 \
  --validate
```

| Option | Description |
|--------|-------------|
| `--input <path>` | Input CSV file (required) |
| `--output <path>` | Output CSV file (required) |
| `--profile <name\|path>` | Built-in profile name or path to custom JSON (required) |
| `--validate` | Run validation on the output CSV after mapping |
| `--list-profiles` | List available built-in profiles and exit |
| `--quiet` | Suppress progress output |

## Role Assignment During Import

Assign roles to users during import using role mapping and role definition files.

```bash
npx workos-migrate import \
  --csv users.csv \
  --role-definitions role-definitions.csv \
  --role-mapping user-role-mapping.csv
```

- **`--role-definitions <path>`** -- a CSV that defines roles (slug, name, type, permissions). Roles are created in WorkOS before the import begins.
- **`--role-mapping <path>`** -- a CSV mapping `external_id` to `role_slug`, assigning roles to users during import.

See `examples/common/role-definitions.csv` and `examples/common/user-role-mapping.csv` for example files.

For full details on role migration, see the [Role Mapping Guide](ROLE-MAPPING.md).

## Large-Scale Imports

For imports with 10,000+ users, the toolkit provides checkpointing and parallel processing to ensure reliability and speed.

### Checkpointing and Resume

Enable checkpointing with `--job-id` to survive crashes and resume interrupted imports:

```bash
npx workos-migrate import \
  --csv users.csv \
  --job-id prod-migration-2024-01-15 \
  --chunk-size 1000
```

**How it works:**
1. The CSV is split into chunks (default: 1,000 rows each).
2. After each chunk completes, a checkpoint is saved to disk.
3. If the import is interrupted, resume from the last completed chunk.

**Resume an interrupted import:**

```bash
# Resume a specific job
npx workos-migrate import --resume prod-migration-2024-01-15

# Resume the most recent job
npx workos-migrate import --resume
```

Resume validates that the CSV file has not changed (SHA-256 hash), restores the organization cache, and continues from the next pending chunk.

**Chunk size trade-offs:**

| Chunk Size | Checkpoint Frequency | Max Lost Work on Crash | Best For |
|------------|---------------------|------------------------|----------|
| 500 | Frequent | ~30 seconds | Unstable networks |
| 1,000 | Balanced | ~1 minute | Most imports (default) |
| 5,000 | Less frequent | ~5 minutes | Stable, high-throughput |

**Checkpoint configuration:**

| Option | Description | Default |
|--------|-------------|---------|
| `--job-id <id>` | Unique job identifier for checkpointing | (none) |
| `--resume [id]` | Resume from checkpoint (optionally specify job ID) | (none) |
| `--chunk-size <n>` | Rows per chunk | 1,000 |
| `--checkpoint-dir <path>` | Directory for checkpoint files | `.workos-checkpoints/` |

**Best practices:**
- Use descriptive job IDs: `--job-id migration-acme-corp-2024-01-15`
- Monitor errors in real time: `tail -f .workos-checkpoints/{job-id}/errors.jsonl | jq .`
- Always test with `--dry-run` before large production imports
- Clean up old checkpoints when no longer needed: `rm -rf .workos-checkpoints/old-job-id`

### Parallel Processing

Use the `--workers` flag to process chunks in parallel across multiple threads, achieving up to 4x throughput:

```bash
npx workos-migrate import \
  --csv users.csv \
  --job-id large-migration \
  --workers 4
```

**Note:** Workers require `--job-id` (or `--resume`) because parallel processing depends on the chunking and checkpoint system.

**Performance comparison:**

| Workers | Throughput | 100K Users | 1M Users |
|---------|------------|------------|----------|
| 1 | ~20 users/sec | ~1.4 hours | ~13.9 hours |
| 2 | ~40 users/sec | ~42 minutes | ~6.9 hours |
| 4 | ~80 users/sec | ~21 minutes | ~3.5 hours |

Beyond 4 workers, the WorkOS API rate limit (50 req/sec) becomes the bottleneck, yielding diminishing returns.

**How it works:**
- A coordinator splits work into chunks and distributes them to worker threads.
- Each worker processes chunks with its own concurrency pool.
- Rate limiting is coordinated across all workers to respect API limits.
- Organization caches are merged back from workers to the coordinator.
- Failed workers do not lose progress -- their chunks are retried on resume.

**Worker count guidelines:**

| Import Size | Recommended Workers | Notes |
|-------------|-------------------|-------|
| < 10K users | 1 (no workers flag) | Overhead outweighs benefit |
| 10K - 50K | 1-2 | Low overhead |
| 50K - 200K | 2-4 | Optimal efficiency |
| 200K - 1M | 4 | Maximum practical speedup |
| 1M+ | 4-6 | Marginal gains beyond 4 |

**Rule of thumb:** use `min(4, CPU_count / 2)` workers.

**Memory usage per worker count:**

| Workers | Total Memory |
|---------|-------------|
| 1 | ~150 MB |
| 2 | ~270 MB |
| 4 | ~480 MB |
| 8 | ~900 MB |

Memory remains constant regardless of CSV size.

### Performance Tuning

**Recommended configurations by scale:**

```bash
# Small imports (< 10K users)
npx workos-migrate import --csv users.csv --concurrency 10

# Medium imports (10K - 100K users)
npx workos-migrate import \
  --csv users.csv \
  --job-id medium-migration \
  --workers 2 \
  --chunk-size 1000 \
  --concurrency 10

# Large imports (100K+ users)
npx workos-migrate import \
  --csv users.csv \
  --job-id large-migration \
  --workers 4 \
  --chunk-size 1000 \
  --concurrency 10

# Very large imports (1M+ users)
npx workos-migrate import \
  --csv users.csv \
  --job-id huge-migration \
  --workers 4 \
  --chunk-size 5000 \
  --concurrency 15 \
  --quiet
```

**Concurrency tuning:**
- `5-10`: Conservative, safer for shared environments
- `10-15`: Recommended for most cases
- `20+`: Risk of triggering rate limits more frequently

**Additional tips:**
- Use `--quiet` for large imports to reduce logging overhead.
- Use `--errors-out output/errors.jsonl` to capture failures for analysis.
- Test your pipeline with `--dry-run` before executing a production import.

## Automation and Scripting

### Non-Interactive Mode

Use `--yes` (or `-y`) to skip all interactive prompts, making the tool suitable for scripts and CI/CD pipelines:

```bash
npx workos-migrate import \
  --csv users.csv \
  --org-id org_123 \
  --yes \
  --errors-out output/errors.jsonl
```

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | All rows succeeded (import) or plan is valid (plan mode) |
| `1` | Errors occurred during import, or plan is invalid |
| `2` | Fatal error (file not found, invalid options, etc.) |

### CI/CD Pipeline Example

```bash
#!/bin/bash
set -e

# Step 1: Validate and auto-fix the CSV
npx workos-migrate validate \
  --csv users.csv \
  --auto-fix \
  --fixed-csv users-fixed.csv

# Step 2: Preview the migration plan
npx workos-migrate import \
  --csv users-fixed.csv \
  --org-id org_123 \
  --plan

# Step 3: Execute the import (non-interactive)
npx workos-migrate import \
  --csv users-fixed.csv \
  --org-id org_123 \
  --job-id auto-migration-$(date +%s) \
  --errors-out output/errors.jsonl \
  --yes

# Step 4: Analyze errors if any were produced
if [ -f output/errors.jsonl ]; then
  npx workos-migrate analyze \
    --errors output/errors.jsonl \
    --retry-csv output/retry.csv

  if [ -f output/retry.csv ]; then
    npx workos-migrate import \
      --csv output/retry.csv \
      --org-id org_123 \
      --yes
  fi
fi
```

## Example Files

The `examples/common/` directory contains reference files you can use as templates:

| File | Description |
|------|-------------|
| `examples/common/example-input.csv` | Basic user import with email, name, password hash, and metadata |
| `examples/common/multi-org-simple.csv` | Multi-org import with `org_external_id` and `org_name` columns |
| `examples/common/multi-org-multi-membership.csv` | Users with memberships across multiple organizations |
| `examples/common/custom-profile.json` | Template for custom field mapping profiles |
| `examples/common/role-definitions.csv` | Role definitions (slug, name, type, permissions) |
| `examples/common/user-role-mapping.csv` | User-to-role assignment mapping (`external_id` -> `role_slug`) |

## Common Options Reference

All options available for the `import` command:

| Option | Description | Default |
|--------|-------------|---------|
| `--csv <path>` | Path to the CSV file to import | (required) |
| `--plan` | Analyze CSV and show migration plan without importing | -- |
| `--dry-run` | Validate CSV without making API calls | -- |
| `-y, --yes` | Skip interactive prompts (for scripting/CI) | -- |
| `--quiet` | Suppress per-row output | -- |
| `--errors-out <path>` | Save errors to file (CSV or JSONL, based on extension) | -- |
| `--concurrency <n>` | Number of concurrent API requests per worker | `10` |
| `--org-id <id>` | WorkOS organization ID (single-org mode) | -- |
| `--org-external-id <id>` | Organization external ID (single-org mode) | -- |
| `--org-name <name>` | Organization name (used with `--create-org-if-missing`) | -- |
| `--create-org-if-missing` | Create the organization if not found | -- |
| `--require-membership` | Require org membership for all users | -- |
| `--job-id <id>` | Job ID to enable checkpointing | -- |
| `--resume [id]` | Resume from a checkpoint | -- |
| `--chunk-size <n>` | Rows per chunk in checkpoint mode | `1000` |
| `--checkpoint-dir <path>` | Directory for checkpoint files | `.workos-checkpoints/` |
| `--workers <n>` | Number of parallel worker threads (requires `--job-id`) | -- |
| `--role-mapping <path>` | User-role mapping CSV (`external_id` -> `role_slug`) | -- |
| `--role-definitions <path>` | Role definitions CSV (creates roles before import) | -- |

## Related Guides

- [CSV Format Reference](CSV-FORMAT.md) -- complete column reference for WorkOS import CSVs
- [Role Mapping Guide](ROLE-MAPPING.md) -- role and permission migration
- [Troubleshooting Guide](TROUBLESHOOTING.md) -- common errors and solutions
- [Wizard Guide](WIZARD.md) -- interactive step-by-step migration experience
