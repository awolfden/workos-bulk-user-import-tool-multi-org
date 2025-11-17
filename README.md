## WorkOS CSV User Importer (Generic)

Import users into WorkOS User Management from a generic CSV file.

### Requirements

- Node.js 18+
- WORKOS_SECRET_KEY set in your environment (do not hardcode).

### Install & Run

You can run via `npx` (using tsx) or locally:

You can set the key inline or via a `.env` file.

Inline:

```bash
WORKOS_SECRET_KEY=sk_test_123 npx tsx bin/import-users.ts --csv path/to/users.csv
```

Using `.env` (the CLI auto-loads `.env` via dotenv):

```bash
echo 'WORKOS_SECRET_KEY=sk_test_123' > .env
npx tsx bin/import-users.ts --csv path/to/users.csv
```

With error export:

```bash
npx tsx bin/import-users.ts --csv path/to/users.csv --errors-out errors.csvsour
```

Options:

- `--csv <path>`: Required. Path to CSV file.
- `--errors-out <path>`: Optional. If given, writes detailed per-record errors. If the extension is `.csv`, writes CSV; otherwise writes JSON.
- `--quiet`: Optional. Suppresses per-record output but still prints a final summary to stderr.
- `--concurrency <n>`: Optional. Max parallel requests (default: 10).
- `--user-export <path>`: Deprecated alias for `--csv`.

### CSV Format

Required column:

- `email`

Optional columns:

- `password`
- `password_hash`
- `password_hash_type`
- `first_name`
- `last_name`
- `email_verified` (supports: true/false, 1/0, yes/no, case-insensitive)
- `external_id`
- `metadata` (JSON string; if invalid JSON, the record fails; if blank/whitespace, ignored)
- `organization` (Organization ID string; if present, an organization membership is created for the user)

Notes:

- Column names are snake_case in CSV and map to WorkOS createUser camelCase:
  - `email` → `email`
  - `password` → `password`
  - `password_hash` → `passwordHash`
  - `password_hash_type` → `passwordHashType`
  - `first_name` → `firstName`
  - `last_name` → `lastName`
  - `email_verified` → `emailVerified`
  - `external_id` → `externalId`
  - `metadata` (JSON) → `metadata` object
  - `organization` (CSV) is used to call `userManagement.createOrganizationMembership({ userId, organizationId })` after the user is created.
- Unknown columns are ignored (a one-time warning is printed).
- If both plaintext `password` and `password_hash/password_hash_type` are present, the importer prefers the hash path and ignores plaintext `password`.

### Behavior

For each row:

- Validates presence of `email`.
- Parses `email_verified` from boolean-like values.
- Parses `metadata` JSON if present and non-empty.
- Builds a payload and calls `workos.userManagement.createUser(...)`.
- Prints per-record status (suppressed under `--quiet`).
- Aggregates errors; continues processing all rows.

Retries:

- Basic retries for rate limiting (HTTP 429) with exponential backoff, up to 3 attempts.

Exit codes:

- 0 when all imported successfully (at least one success and zero failures).
- Non-zero when any errors occur, or on fatal errors.

### Summary Output

Example:

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

Status rules:

- Success: errors === 0 and successes > 0
- Completed with errors: errors > 0 and successes > 0
- Failed: errors > 0 and successes === 0

### Error Export (`--errors-out`)

- If path ends with `.csv`, writes: `recordNumber,email,userId,errorMessage,httpStatus,workosCode,workosRequestId,timestamp,rawRow`.
- Otherwise writes JSON array with the same fields.

### Example CSV

See `examples/example-input.csv` for sample rows:

- Just email
- With first/last name and email_verified
- With plaintext password
- With password_hash + password_hash_type
- With metadata JSON

### Development

Install dependencies:

```bash
pnpm i # or npm i / yarn
```

Run locally:

```bash
WORKOS_SECRET_KEY=sk_test_123 \
  pnpm start -- --csv examples/example-input.csv
```

Type-check:

```bash
pnpm run typecheck
```
