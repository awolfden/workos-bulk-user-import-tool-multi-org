## WorkOS Multi-Org User Importer (Enterprise)

> **Note:** This is the **enterprise multi-org version** for importing users across multiple organizations at scale.
> For single-org imports, see: [workos-bulk-user-import-tool](https://github.com/awolfden/workos-bulk-user-import-tool)

Import users from a CSV file into WorkOS User Management with support for **multiple organizations**, **organization caching**, and **million+ user scale**.

### Key Differences from Single-Org Tool
- ✅ Multiple organizations in one CSV file
- ✅ Organization caching for performance
- ✅ Designed for 1M+ users across 1K+ organizations
- ✅ Based on production-tested v1.1.0 foundation

---

### What you need before you start

- Node.js 18+ installed on your computer
- Your WorkOS Secret Key (found in your WorkOS Dashboard under API Keys)

Do not share or hardcode your Secret Key. You will paste it into your command or store it in a `.env` file on your machine.

---

### Quick Start (recommended)

Pick one of the two simple ways to run the importer.

1. One‑off run (paste your key inline)

```bash
WORKOS_SECRET_KEY=sk_test_123 npx tsx bin/import-users.ts --csv path/to/users.csv
```

2. Reuse your key with a `.env` file

```bash
echo 'WORKOS_SECRET_KEY=sk_test_123' > .env
npx tsx bin/import-users.ts --csv path/to/users.csv
```

Optional: Save any failed rows to a file so you can fix and re‑try:

```bash
npx tsx bin/import-users.ts --csv path/to/users.csv --errors-out errors.csv
```

---

### Choose how to import: with or without an Organization

- No org flags: Creates users only. No memberships are created.
- `--org-id <id>`: Creates each user and adds them to an existing Organization (by its WorkOS ID).
- `--org-external-id <externalId>`: Looks up an Organization by your own external ID. Combine with:
  - `--create-org-if-missing --org-name "<name>"` to create the Organization if it doesn’t exist.
- Add `--require-membership` if you want the tool to delete any newly created user whose membership could not be created (keeps things tidy).

Examples

User‑only:

```bash
WORKOS_SECRET_KEY=sk_test_123 \
  npx tsx bin/import-users.ts --csv examples/example-input.csv
```

Single‑org (existing org by ID):

```bash
WORKOS_SECRET_KEY=sk_test_123 \
  npx tsx bin/import-users.ts --csv examples/example-input.csv --org-id org_123
```

Single‑org (by external_id, create if missing):

```bash
WORKOS_SECRET_KEY=sk_test_123 \
  npx tsx bin/import-users.ts \
    --csv examples/example-input.csv \
    --org-external-id acme-123 \
    --create-org-if-missing \
    --org-name "Acme Inc."
```

---

### Multi-Organization Mode (NEW in v2.0)

Import users across **multiple organizations in a single CSV file** with intelligent caching for optimal performance.

#### When to Use Multi-Org Mode

- Importing users from multiple customer organizations
- Migrating data from a multi-tenant system
- Bulk onboarding across different companies
- Testing with diverse organization structures

#### CSV Format for Multi-Org

Add organization columns to your CSV to enable multi-org mode:

```csv
email,first_name,last_name,org_external_id,org_name
alice@acme.com,Alice,Smith,acme-corp,Acme Corporation
bob@acme.com,Bob,Jones,acme-corp,Acme Corporation
charlie@beta.com,Charlie,Brown,beta-inc,Beta Inc
dana@beta.com,Dana,White,beta-inc,Beta Inc
eve@gamma.com,Eve,Green,gamma-llc,Gamma LLC
```

**Organization Columns:**
- `org_id` - Direct WorkOS organization ID (fastest, no API lookup needed)
- `org_external_id` - Your external organization identifier (cached API lookup)
- `org_name` - Organization name (only used when creating new organizations)

**Important:** Each row can specify its own organization. Users will be added to the organization specified in their row.

#### Organization Resolution Priority

When processing each row, the tool resolves organizations in this order:

1. **`org_id` provided** → Use directly (cached for subsequent rows)
2. **`org_external_id` provided** → Lookup via WorkOS API (cached)
3. **Organization not found + `org_name` provided** → Create new organization
4. **Organization not found + no `org_name`** → Error (row fails)

#### How Multi-Org Mode Works

**Automatic Mode Detection:**
```
┌─────────────────────────────────────────────────┐
│ CLI Flags Present?                              │
│ (--org-id or --org-external-id)                 │
├─────────────────────────────────────────────────┤
│ YES → Single-Org Mode (v1.x compatible)         │
│  ↳ All users added to same organization         │
│                                                  │
│ NO → Check CSV Headers                          │
│  ↳ Has org_id or org_external_id columns?       │
│     • YES → Multi-Org Mode                      │
│     • NO  → User-Only Mode (no memberships)     │
└─────────────────────────────────────────────────┘
```

**Cache Performance:**
- 10,000 organization cache capacity
- 99%+ hit rate for typical workloads
- Request coalescing prevents duplicate API calls
- Statistics displayed in summary

#### Multi-Org Examples

**Example 1: Basic Multi-Org Import**
```bash
WORKOS_SECRET_KEY=sk_test_123 \
  npx tsx bin/import-users.ts --csv multi-org-users.csv
```

The tool automatically detects org columns and enables multi-org mode.

**Example 2: Multi-Org with Existing Organizations**
```csv
email,first_name,org_external_id
alice@acme.com,Alice,acme-corp
bob@beta.com,Bob,beta-inc
charlie@acme.com,Charlie,acme-corp
```

Expected behavior:
- Looks up `acme-corp` and `beta-inc` via API
- Caches both organizations after first lookup
- Third row uses cached `acme-corp` (no API call)

**Example 3: Multi-Org with Organization Creation**
```csv
email,first_name,org_external_id,org_name
alice@newco.com,Alice,newco-2024,NewCo Inc
bob@newco.com,Bob,newco-2024,NewCo Inc
```

Expected behavior:
- First row: Creates `NewCo Inc` with external_id `newco-2024`
- Second row: Uses cached organization (no API call)

**Example 4: Mixed Strategies**
```csv
email,org_id,org_external_id,org_name
alice@acme.com,org_01ABC,,,
bob@beta.com,,beta-corp,Beta Inc
charlie@gamma.com,,gamma-llc,
```

- Row 1: Direct org_id (fastest)
- Row 2: Lookup by external_id, create if missing
- Row 3: Lookup by external_id only (error if not found)

#### Performance Characteristics

**Cache Effectiveness:**

| Scenario | Orgs | Users | Cache Hits | Cache Misses | API Calls | Time Saved |
|----------|------|-------|------------|--------------|-----------|------------|
| 100 users, 5 orgs | 5 | 100 | 95 | 5 | 5 | 95% |
| 1K users, 50 orgs | 50 | 1,000 | 950 | 50 | 50 | 95% |
| 10K users, 100 orgs | 100 | 10,000 | 9,900 | 100 | 100 | 99% |
| 100K users, 1K orgs | 1,000 | 100,000 | 99,000 | 1,000 | 1,000 | 99% |

**Memory Usage:**
- Constant memory regardless of CSV size
- ~5-10MB for 10K cached organizations
- Streaming CSV processing (no full file load)

**Example Summary with Cache Stats:**
```
┌────────────────────────┐
│ SUMMARY                │
│ Status: Success        │
│ Users imported: 100/100│
│ Memberships created: 100│
│ Duration: 12.3 s       │
│ Warnings: 0            │
│ Errors: 0              │
│ Cache hits: 95         │
│ Cache misses: 5        │
│ Cache hit rate: 95.0%  │
└────────────────────────┘
```

#### Mode Conflict Handling

**What happens if you provide both CLI flags AND org columns in CSV?**

CLI flags take precedence (backward compatibility):

```bash
npx tsx bin/import-users.ts \
  --csv multi-org-users.csv \
  --org-id org_123
```

Result:
- ⚠️ Warning displayed: "CSV contains org columns but CLI flags provided"
- All users added to `org_123` (single-org mode)
- Org columns in CSV are ignored
- This prevents accidental multi-org mode in existing scripts

#### Error Handling

**New Error Type: `org_resolution`**

When organization resolution fails, errors include full context:

```json
{
  "recordNumber": 5,
  "email": "user@example.com",
  "errorType": "org_resolution",
  "errorMessage": "Organization not found: acme-corp",
  "orgExternalId": "acme-corp",
  "httpStatus": 404,
  "timestamp": "2025-12-31T10:15:30Z"
}
```

**Common Org Resolution Errors:**
- Organization not found (404)
- Organization external_id already exists (when creating)
- Both org_id and org_external_id specified in same row (validation error)
- Missing org_name when creating new organization

#### Migration from Single-Org to Multi-Org

**Step 1:** Add org columns to your CSV
```bash
# Before (single-org)
email,first_name,last_name
alice@acme.com,Alice,Smith

# After (multi-org)
email,first_name,last_name,org_external_id
alice@acme.com,Alice,Smith,acme-corp
```

**Step 2:** Remove CLI org flags
```bash
# Before
npx tsx bin/import-users.ts --csv users.csv --org-id org_123

# After (automatic multi-org detection)
npx tsx bin/import-users.ts --csv users.csv
```

**Step 3:** Verify with dry-run
```bash
npx tsx bin/import-users.ts --csv users.csv --dry-run
```

Look for: "Multi-org mode: Organizations will be resolved per-row from CSV"

#### Advanced: Cache Configuration

The organization cache is automatically optimized for your workload. Default settings:

- **Capacity:** 10,000 organizations
- **Eviction:** LRU (Least Recently Used)
- **TTL:** Disabled (import workloads are one-shot)
- **Coalescing:** Enabled (prevents duplicate API calls)

These defaults work for 99%+ of use cases (100-1,000 organizations).

---

### CSV format at a glance

Required column:

- `email`

Optional columns:

- `first_name`
- `last_name`
- `password`
- `password_hash`
- `password_hash_type`
- `email_verified` (true/false, 1/0, yes/no; case‑insensitive)
- `external_id`
- `metadata` (JSON text; blank is ignored, invalid JSON will cause that row to fail)
- `org_id` (WorkOS organization ID for multi-org mode)
- `org_external_id` (External organization ID for multi-org mode)
- `org_name` (Organization name for multi-org mode, used when creating orgs)

Small example

```csv
email,first_name,last_name,email_verified,metadata
ada@example.com,Ada,Lovelace,true,{"role":"admin"}
grace@example.com,Grace,Hopper,yes,{"team":"eng"}
```

Notes

- Column names in the CSV are snake_case and map to WorkOS fields:
  - `password_hash` → `passwordHash`
  - `password_hash_type` → `passwordHashType`
  - `first_name` → `firstName`
  - `last_name` → `lastName`
  - `email_verified` → `emailVerified`
  - `external_id` → `externalId`
  - `metadata` (JSON) → `metadata` object
- Unknown columns are ignored (you’ll see one warning).
- If both plaintext `password` and `password_hash/password_hash_type` are present, the importer prefers the hash values and ignores `password`.

---

### Running options (flags)

- `--csv <path>`: Required. Path to your CSV file.
- `--errors-out <path>`: Optional. Save detailed errors to a file. If the file ends with `.csv`, writes CSV; otherwise writes JSON.
- `--quiet`: Optional. Hides per‑row messages but still prints the final summary.
- `--concurrency <n>`: Optional. Speeds up or slows down the number of parallel requests (default: 10).
- `--org-id <id>`: Optional. Add users to an existing Organization by WorkOS ID.
- `--org-external-id <externalId>`: Optional. Add users to an Organization resolved by your own external ID.
- `--create-org-if-missing`: Optional. Used with `--org-external-id`; creates the org if it doesn’t exist (requires `--org-name`).
- `--org-name <name>`: Required with `--create-org-if-missing`. Name of the new Organization.
- `--require-membership`: Optional. If membership creation fails, delete the user created in this run and count it as a failure.
- `--dry-run`: Optional. Validate and show what would happen, but don’t call WorkOS APIs or create anything.
- `--user-export <path>`: Deprecated alias for `--csv`.

---

### What happens when you run it

For each row in your CSV, the tool:

- Checks that `email` exists
- Converts `email_verified` into true/false
- Parses `metadata` if present
- Calls WorkOS to create the user (and membership if you chose an org mode)
- Shows each row’s result (unless `--quiet`) and then a final summary

It also retries rate‑limited requests (HTTP 429) with exponential backoff, up to 3 attempts.

Exit codes

- 0 when all rows that were processed succeeded (at least one success and zero failures)
- Non‑zero when any errors occur, or on fatal errors

Summary example

```
┌──────────────────────────────────────┐
│ SUMMARY                              │
│ Status: Completed with errors        │
│ Users imported: 42/50                │
│ Duration: 3.2 s                      │
│ Warnings: 0                          │
│ Errors: 8                            │
└──────────────────────────────────────┘
```

Status rules

- Success: errors === 0 and successes > 0
- Completed with errors: errors > 0 and successes > 0
- Failed: errors > 0 and successes === 0

---

### Saving and reviewing errors (`--errors-out`)

- If your output file ends with `.csv`, it writes columns:
  `recordNumber,email,userId,errorMessage,httpStatus,workosCode,workosRequestId,timestamp,rawRow`
- Otherwise, it writes a JSON array with the same fields.

You can open the CSV in a spreadsheet, fix the problematic rows, and re‑run the importer on just those rows.

---

### Troubleshooting

- “WORKOS_SECRET_KEY is missing”  
  Make sure you included `WORKOS_SECRET_KEY=...` before the command, or created a `.env` file in the same folder.

- “Cannot find CSV file”  
  Double‑check the path after `--csv`. If your file is on your Desktop, for example: `--csv ~/Desktop/users.csv`

- “metadata is invalid JSON”  
  Ensure the `metadata` cell contains valid JSON, such as `{"role":"admin"}` (use double quotes).

- “Membership failed” (when using org mode)  
  Add `--require-membership` to automatically delete users created in this run if membership creation fails.

---

### Example CSVs

**Single-Org / User-Only Examples:**
See `examples/example-input.csv` for samples including:

- Just email
- With first/last name and email_verified
- With plaintext password
- With password_hash + password_hash_type
- With metadata JSON

**Multi-Org Examples:**
See `examples/multi-org-simple.csv` for multi-organization import example:

- 10 users across 4 different organizations
- Demonstrates org_external_id and org_name columns
- Shows cache effectiveness (4 misses, 6 hits = 60% hit rate)

---

### Performance & Memory Usage

This tool is optimized for large-scale imports with bounded memory usage:

**Memory Characteristics:**

- Streams CSV files (no full file load into memory)
- Errors streamed to disk in JSONL format by default
- Constant memory usage regardless of CSV size
- Processes in batches to prevent memory exhaustion

**Performance Benchmarks:**

| Users | Duration\*     | Memory Usage | Recommended Flags          |
| ----- | -------------- | ------------ | -------------------------- |
| 1K    | ~30-40 seconds | <50 MB       | Default settings           |
| 10K   | ~3-4 minutes   | ~50 MB       | Default settings           |
| 50K   | ~15-20 minutes | ~75 MB       | `--concurrency 20`         |
| 100K  | ~30-40 minutes | ~100 MB      | `--concurrency 20 --quiet` |
| 500K+ | ~2.5-3.5 hours | ~150 MB      | `--concurrency 20 --quiet` |

\* Assumes 50 req/sec rate limit, 200ms avg API latency, with organization membership

**Best Practices for Large Imports:**

1. **Use JSONL for error output** (default):

   ```bash
   --errors-out errors.jsonl  # Streamed to disk, bounded memory
   ```

2. **Avoid CSV error output for large imports**:

   ```bash
   --errors-out errors.csv    # Loads all errors in memory (not recommended for >10K rows)
   ```

3. **Increase concurrency for faster imports**:

   ```bash
   --concurrency 20           # Default is 10, increase if API allows
   ```

4. **Use quiet mode to reduce logging overhead**:

   ```bash
   --quiet                    # Suppresses per-record logging
   ```

5. **Test with dry-run first**:
   ```bash
   --dry-run                  # Validates CSV without API calls
   ```

**Memory Optimization (v1.1.0+):**

- WorkOS client singleton (prevents connection exhaustion)
- Bounded in-flight promise array (constant memory)
- Error streaming (no accumulation in memory)
- Rate limiter cleanup (proper resource management)

---

### Testing & Development

Generate test CSV files:

```bash
# Generate 100K users
npx tsx scripts/generate-test-csv.ts 100000 examples/hundred-thousand-users.csv

# Generate with intentional errors (for testing)
npx tsx scripts/generate-test-csv.ts 50000 examples/test-with-errors.csv --with-errors
```

Run memory usage test:

```bash
# Test memory usage with large CSV (dry-run mode, no API calls)
npx tsx scripts/memory-test.ts examples/hundred-thousand-users.csv
```

Verify rate limiting:

```bash
# Quick verification (recommended - runs in ~5 seconds)
npx tsx scripts/rate-limit-quick-test.ts

# Visual demonstration
npx tsx scripts/rate-limit-demo.ts

# Comprehensive test suite (slower - takes ~1 minute)
npx tsx scripts/rate-limit-test.ts
```

**Rate Limit Configuration:**

- WorkOS limit: 500 requests per 10 seconds (50 req/sec)
- Tool configuration: 50 req/sec with 50 burst capacity
- ✅ Guaranteed to never exceed limits at any scale

**Multi-Org Scale Testing:**

Generate multi-org test CSVs at various scales:

```bash
# Small scale: 100 users across 10 orgs (90% hit rate)
npx tsx scripts/generate-multi-org-csv.ts 100 10 examples/test-100-10.csv

# Medium scale: 1K users across 50 orgs (95% hit rate)
npx tsx scripts/generate-multi-org-csv.ts 1000 50 examples/test-1k-50.csv

# Large scale: 10K users across 100 orgs (99% hit rate)
npx tsx scripts/generate-multi-org-csv.ts 10000 100 examples/test-10k-100.csv

# Very large scale: 100K users across 1K orgs (realistic enterprise)
npx tsx scripts/generate-multi-org-csv.ts 100000 1000 examples/test-100k-1k.csv

# Skewed distribution (80/20 rule - realistic workload)
npx tsx scripts/generate-multi-org-csv.ts 10000 100 examples/test-skewed.csv --distribution skewed
```

Run comprehensive cache performance tests:

```bash
# Generates 7 test CSVs and validates cache performance
npx tsx scripts/multi-org-cache-test.ts
```

**Scale Test Results (Validated):**

All tests passed ✅ with the following results:

| Scale | Users | Orgs | Cache Hit Rate | API Calls | Memory |
|-------|-------|------|----------------|-----------|--------|
| Small | 100 | 10 | 90.0% | 10 | <0.01 MB |
| Medium | 1K | 50 | 95.0% | 50 | ~0.01 MB |
| Large | 10K | 100 | 99.0% | 100 | ~0.02 MB |
| Very Large | 10K | 1K | 90.0% | 1,000 | ~0.19 MB |

**Key Findings:**
- Cache hit rate increases with more users per org (90-99%)
- Memory usage depends only on unique org count, not user count
- Constant memory profile regardless of CSV size (streaming)
- Request coalescing prevents duplicate API calls at high concurrency
- LRU eviction ensures bounded memory even with 10K+ orgs

**Testing Multi-Org Imports:**

Test with generated CSV (no API calls):
```bash
# Validate CSV structure and mode detection
npx tsx bin/import-users.ts --csv examples/test-1k-50.csv --dry-run
```

Real import test (requires WorkOS credentials):
```bash
# Import and verify cache statistics in summary
WORKOS_SECRET_KEY=sk_test_123 \
  npx tsx bin/import-users.ts --csv examples/test-1k-50.csv
```

Expected summary output:
```
┌────────────────────────┐
│ SUMMARY                │
│ Status: Success        │
│ Users imported: 1000   │
│ Memberships created: 1000
│ Duration: 25.3 s       │
│ Warnings: 0            │
│ Errors: 0              │
│ Cache hits: 950        │
│ Cache misses: 50       │
│ Cache hit rate: 95.0%  │
└────────────────────────┘
```

Install dependencies:

```bash
pnpm i # or npm i / yarn
```

Run locally:

```bash
WORKOS_SECRET_KEY=sk_test_123 \
  pnpm start --csv examples/example-input.csv
```

Type‑check:

```bash
pnpm run typecheck
```
