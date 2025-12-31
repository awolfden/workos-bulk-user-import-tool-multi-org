## WorkOS CSV User Importer (Generic)

Import a list of users from a CSV file into WorkOS User Management. This guide is written for non-technical users and includes copy‑and‑paste commands.

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

See `examples/example-input.csv` for samples including:

- Just email
- With first/last name and email_verified
- With plaintext password
- With password_hash + password_hash_type
- With metadata JSON

---

### Performance & Memory Usage

This tool is optimized for large-scale imports with bounded memory usage:

**Memory Characteristics:**
- Streams CSV files (no full file load into memory)
- Errors streamed to disk in JSONL format by default
- Constant memory usage regardless of CSV size
- Processes in batches to prevent memory exhaustion

**Performance Benchmarks:**

| Users | Duration* | Memory Usage | Recommended Flags |
|-------|-----------|--------------|-------------------|
| 1K | ~30-40 seconds | <50 MB | Default settings |
| 10K | ~3-4 minutes | ~50 MB | Default settings |
| 50K | ~15-20 minutes | ~75 MB | `--concurrency 20` |
| 100K | ~30-40 minutes | ~100 MB | `--concurrency 20 --quiet` |
| 500K+ | ~2.5-3.5 hours | ~150 MB | `--concurrency 20 --quiet` |

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

Install dependencies:

```bash
pnpm i # or npm i / yarn
```

Run locally:

```bash
WORKOS_SECRET_KEY=sk_test_123 \
  pnpm start -- --csv examples/example-input.csv
```

Type‑check:

```bash
pnpm run typecheck
```
