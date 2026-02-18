# Migrating from Clerk

Step-by-step guide for migrating users from Clerk to WorkOS.

## Overview

The Clerk migration transforms a Clerk user CSV export into WorkOS-compatible format, then validates and imports the users. Unlike Auth0 (which has an API-based export), Clerk migration starts from a CSV file you export from the Clerk dashboard.

**Migration flow:**

1. **Export** — Download your user CSV from the Clerk dashboard
2. **Transform** — Convert Clerk CSV fields to WorkOS format (`transform-clerk`)
3. **Validate** — Check the transformed CSV for errors (`validate-csv`)
4. **Import** — Migrate users into WorkOS (`import-users` / `orchestrate-migration`)

You can run these steps manually via CLI or let the wizard handle them automatically.

## Prerequisites

Before starting:

1. **Clerk CSV export** — Exported from the Clerk dashboard (see [Obtaining Your Clerk CSV Export](#obtaining-your-clerk-csv-export))
2. **WorkOS API key** — Set `WORKOS_SECRET_KEY` environment variable
3. **Node.js 18+** — Required for execution
4. **Organization mapping CSV** (optional) — Maps Clerk users to WorkOS organizations (see [Organization Mapping CSV](#organization-mapping-csv))

```bash
export WORKOS_SECRET_KEY=sk_test_your_key_here
```

## Obtaining Your Clerk CSV Export

Clerk provides a user export feature from the dashboard:

1. Log in to [Clerk Dashboard](https://dashboard.clerk.com)
2. Navigate to **Users** in the left sidebar
3. Click the **Export** button
4. Select **CSV** format
5. Download the exported file

The exported CSV should contain these columns:

```
id,first_name,last_name,username,primary_email_address,primary_phone_number,
verified_email_addresses,unverified_email_addresses,verified_phone_numbers,
unverified_phone_numbers,totp_secret,password_digest,password_hasher
```

An example is included at `examples/clerk-export.csv`.

## Organization Mapping CSV

If your Clerk users belong to organizations, you need a separate CSV that maps each user to their organization. Clerk does not include org membership in its user export, so you must provide this mapping yourself.

The mapping CSV must have a `clerk_user_id` column plus one or more organization columns.

### Format Variants

**1. `org_id` — Direct WorkOS org ID (org already exists in WorkOS)**

```csv
clerk_user_id,org_id
user_01,org_abc123
user_02,org_def456
```

**2. `org_external_id` + `org_name` — Auto-create orgs during import**

```csv
clerk_user_id,org_external_id,org_name
user_01,acme-corp,Acme Corporation
user_02,acme-corp,Acme Corporation
user_04,beta-inc,Beta Inc
```

The importer will look up each org by `org_external_id`. If the org doesn't exist, it auto-creates one with the given `org_name` and `org_external_id`.

**3. `org_external_id` only — Lookup by external ID (org must exist)**

```csv
clerk_user_id,org_external_id
user_01,acme-corp
user_02,beta-inc
```

The importer looks up the org by external ID. If it doesn't exist, the import for that user fails.

**4. `org_name` only — Lookup or create by name**

```csv
clerk_user_id,org_name
user_01,Acme Corporation
user_02,Beta Inc
```

The importer looks up the org by name. If it doesn't exist, it auto-creates one.

### Priority Rules

When multiple org columns are present, `org_id` takes priority:

- If `org_id` is provided, it is used directly — `org_external_id` and `org_name` are ignored
- If `org_id` is absent, `org_external_id` and `org_name` are passed through to the import step

An example is included at `examples/clerk-org-mapping.csv`.

## Option A: Wizard (Recommended)

The wizard automates the full transform → validate → import pipeline.

### Launch

```bash
WORKOS_SECRET_KEY=sk_test_123 npx tsx bin/migrate-wizard.ts
```

### Wizard Prompts

1. **What are you migrating from?** — Select **Clerk**
2. **Path to your Clerk CSV export file** — Enter the path to your exported CSV
3. **Do you have a user-to-organization mapping CSV?** — Yes/No
   - If yes: enter the path to your org mapping CSV
   - Import mode auto-sets to **multi-org** when an org mapping is provided
4. If no org mapping: **How do you want to import users?** — Single org or multi-org
5. **Scale & performance** — User count, checkpointing, workers
6. **Validation** — Validate CSV, auto-fix issues
7. **Error handling** — Log errors to file
8. **Dry run** — Test before live import

### What the Wizard Does Automatically

1. **Transform Clerk Export** — Runs `transform-clerk` to convert your Clerk CSV to WorkOS format (outputs `clerk-transformed.csv`)
2. **Validate CSV** — Runs `validate-csv` with auto-fix (outputs `users-validated.csv`)
3. **Plan Import** — Shows estimated duration and configuration
4. **Dry Run** (if enabled) — Tests import without creating users
5. **Execute Import** — Imports users into WorkOS
6. **Analyze Errors** (if any) — Generates retry CSV for failed records

## Option B: CLI (Step-by-Step)

### Step 1: Transform Clerk Export

**Without org mapping:**

```bash
npx tsx bin/transform-clerk.ts \
  --clerk-csv clerk-export.csv \
  --output workos-users.csv
```

**With org mapping:**

```bash
npx tsx bin/transform-clerk.ts \
  --clerk-csv clerk-export.csv \
  --org-mapping user-org-mapping.csv \
  --output workos-users.csv
```

**All flags:**

| Flag | Required | Description |
|------|----------|-------------|
| `--clerk-csv <path>` | Yes | Path to Clerk CSV export |
| `--output <path>` | Yes | Output path for WorkOS CSV |
| `--org-mapping <path>` | No | Path to organization mapping CSV |
| `--skipped-users <path>` | No | Path for skipped user records (default: `clerk-skipped-users.jsonl`) |
| `--quiet` | No | Suppress output messages |

The transform step produces a summary showing total users, transformed count, skipped count, password stats, and org mapping stats.

### Step 2: Validate CSV

```bash
npx tsx bin/validate-csv.ts \
  --csv workos-users.csv \
  --auto-fix \
  --fixed-csv users-validated.csv \
  --report validation-report.json
```

### Step 3: Import Users

**Simple import:**

```bash
npx tsx bin/import-users.ts --csv users-validated.csv
```

**Multi-org import with workers:**

```bash
npx tsx bin/import-users.ts \
  --csv users-validated.csv \
  --job-id clerk-migration \
  --workers 4
```

**Dry run first:**

```bash
npx tsx bin/import-users.ts --csv users-validated.csv --dry-run
```

## Password Handling

Clerk stores password hashes alongside user records. The transformer supports **bcrypt** hashes only.

| Hasher | Supported | What Happens |
|--------|-----------|--------------|
| `bcrypt` | Yes | Hash is migrated — users keep their existing password |
| `argon2` | No | Password field omitted, warning logged |
| `scrypt` | No | Password field omitted, warning logged |
| `pbkdf2` | No | Password field omitted, warning logged |

Users whose passwords are skipped will need to **reset their password on first login** to WorkOS.

The transformation summary shows how many users had passwords migrated vs. skipped. Check the `clerk-skipped-users.jsonl` file for details on individual skipped records.

## Field Mapping Reference

| Clerk Field | WorkOS Field | Notes |
|-------------|-------------|-------|
| `primary_email_address` | `email` | Required — users without an email are skipped |
| `first_name` | `first_name` | |
| `last_name` | `last_name` | |
| `id` | `external_id` | Clerk user ID (e.g., `user_01`) preserved as external ID |
| `password_digest` | `password_hash` | Bcrypt only |
| `password_hasher` | `password_hash_type` | Set to `bcrypt` when applicable |
| — | `email_verified` | Always set to `true` |

## Metadata

Extra Clerk fields that don't have a direct WorkOS equivalent are stored in the `metadata` JSON column:

| Metadata Key | Source Field |
|-------------|-------------|
| `clerk_user_id` | `id` (always included for cross-referencing) |
| `username` | `username` |
| `primary_phone_number` | `primary_phone_number` |
| `verified_phone_numbers` | `verified_phone_numbers` |
| `unverified_phone_numbers` | `unverified_phone_numbers` |
| `verified_email_addresses` | `verified_email_addresses` |
| `unverified_email_addresses` | `unverified_email_addresses` |
| `totp_secret` | `totp_secret` |

Only non-empty fields are included in the metadata JSON.

## Troubleshooting

### "Clerk CSV file not found"

Verify the path to your Clerk export CSV is correct:

```bash
ls -la clerk-export.csv
```

### "Org mapping file not found"

Verify the path to your organization mapping CSV:

```bash
ls -la user-org-mapping.csv
```

### "Missing required field: primary_email_address"

The user row in the Clerk CSV has no email address. These users are automatically skipped and logged to the skipped users file (`clerk-skipped-users.jsonl`).

### "Unsupported password hasher" warning

The user has a non-bcrypt password hash (argon2, scrypt, or pbkdf2). Their password will not be migrated — they'll need to reset on first login. This is expected behavior, not an error.

### Users missing from output

Check the transformation summary and `clerk-skipped-users.jsonl` for users that were skipped due to missing email addresses.

### Org mapping not applied

Ensure your org mapping CSV has a `clerk_user_id` column that matches the `id` column in the Clerk export. The match is exact, so values like `user_01` must match between both files.

### Import fails with "organization not found"

If using `org_external_id` without `org_name`, the organization must already exist in WorkOS. Either:
- Create the organization in WorkOS first, or
- Add an `org_name` column to your mapping CSV so the org is auto-created during import

## Related Documentation

- [Wizard Guide](../getting-started/WIZARD.md) — Interactive migration walkthrough
- [CSV Format Reference](CSV-FORMAT.md) — WorkOS CSV column reference
- [Multi-Organization Imports](MULTI-ORG.md) — Multi-org import details
- [Password Migration](PASSWORD-MIGRATION.md) — Password hash formats
- [Troubleshooting](TROUBLESHOOTING.md) — General troubleshooting
