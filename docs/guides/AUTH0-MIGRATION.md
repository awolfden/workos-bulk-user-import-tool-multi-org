# Auth0 Migration Guide

Complete guide for migrating users from Auth0 to WorkOS. This covers exporting users and organizations, merging password hashes, validating data, importing to WorkOS, and handling errors.

## Prerequisites

- **WorkOS account** with a Secret Key (`WORKOS_SECRET_KEY` environment variable)
- **Auth0 Machine-to-Machine (M2M) application** with Management API access and the following scopes:
  - `read:users`
  - `read:organizations`
  - `read:organization_members`
- **Node.js 18+** and the toolkit installed (`npm install`)

To create the M2M application:

1. Go to your Auth0 Dashboard > Applications > Create Application
2. Choose "Machine to Machine Applications"
3. Authorize it for the "Auth0 Management API"
4. Grant the scopes listed above
5. Note the **Domain**, **Client ID**, and **Client Secret** from the application settings

## Using the Wizard (Recommended)

The interactive wizard handles the full migration workflow -- export, validate, and import -- with guided prompts:

```bash
npx workos-migrate wizard --source auth0
```

The wizard will prompt you for Auth0 credentials, detect organizations, and walk you through each step. For details, see the [Wizard Guide](WIZARD.md).

The rest of this guide covers the manual step-by-step approach, which gives you full control over each phase.

---

## Manual Migration Steps

### Step 1: Export Users from Auth0

Export all users and their organization memberships to a WorkOS-compatible CSV:

```bash
npx workos-migrate export-auth0 \
  --domain mycompany.auth0.com \
  --client-id YOUR_CLIENT_ID \
  --client-secret YOUR_CLIENT_SECRET \
  --output output/auth0-export.csv
```

#### Export Options

| Flag | Description | Default |
|------|-------------|---------|
| `--domain <domain>` | Auth0 tenant domain (e.g., `mycompany.auth0.com`) | Required |
| `--client-id <id>` | M2M application Client ID | Required |
| `--client-secret <secret>` | M2M application Client Secret | Required |
| `--output <path>` | Output CSV file path | Required |
| `--orgs <ids...>` | Filter to specific Auth0 organization IDs (space-separated) | All orgs |
| `--page-size <n>` | API pagination size (max: 100) | 100 |
| `--rate-limit <n>` | API requests per second | 50 |
| `--user-fetch-concurrency <n>` | Parallel user fetch count (max: 50) | 10 |
| `--use-metadata` | Use `user_metadata` for org discovery instead of Organizations API | false |
| `--metadata-org-id-field <field>` | Custom metadata field for org ID (e.g., `company_id`) | -- |
| `--metadata-org-name-field <field>` | Custom metadata field for org name (e.g., `company_name`) | -- |
| `--job-id <id>` | Job ID for export checkpointing (enables resumability) | -- |
| `--resume [jobId]` | Resume from an existing export checkpoint | -- |
| `--quiet` | Suppress progress output | false |

#### Export Specific Organizations

```bash
npx workos-migrate export-auth0 \
  --domain mycompany.auth0.com \
  --client-id YOUR_CLIENT_ID \
  --client-secret YOUR_CLIENT_SECRET \
  --output output/filtered-export.csv \
  --orgs org_abc123 org_def456 org_ghi789
```

#### Auth0 Rate Limits by Plan

Set `--rate-limit` to match your Auth0 plan tier to avoid 429 errors:

| Auth0 Plan | Rate Limit | Recommended Flag |
|------------|------------|------------------|
| Free | 2 req/sec | `--rate-limit 2 --user-fetch-concurrency 2` |
| Developer | 50 req/sec | `--rate-limit 50` (default) |
| Enterprise | 100+ req/sec | `--rate-limit 100 --user-fetch-concurrency 20` |

The exporter includes automatic retry logic with exponential backoff and respects Auth0's `Retry-After` header.

#### Export Performance

With the default parallel user fetching (10 concurrent) at 50 requests/second:

| Users | Estimated Time |
|-------|---------------|
| 10K | 30-60 seconds |
| 50K | 2-3 minutes |
| 100K | 4-6 minutes |

The exporter uses a streaming architecture, so memory usage stays at approximately 50 MB regardless of dataset size.

#### Output CSV Format

The exporter generates a CSV with the following columns:

| Column | Description | Example |
|--------|-------------|---------|
| `email` | User email (required) | `alice@acme.com` |
| `first_name` | Given name | `Alice` |
| `last_name` | Family name | `Smith` |
| `email_verified` | Email verification status | `true` |
| `external_id` | Auth0 user ID | `auth0\|123456` |
| `org_external_id` | Auth0 organization ID | `org_abc123` |
| `org_name` | Organization display name | `Acme Corporation` |
| `metadata` | Merged user_metadata + app_metadata (JSON) | `{"department":"Engineering"}` |

Auth0 field mapping:

- `user.email` -> `email`
- `user.given_name` -> `first_name`
- `user.family_name` -> `last_name`
- `user.email_verified` -> `email_verified`
- `user.user_id` -> `external_id`
- `merge(user_metadata, app_metadata)` -> `metadata` (JSON string)
- `org.id` -> `org_external_id`
- `org.display_name` -> `org_name`

### Step 2: Merge Password Hashes (Optional)

Auth0 does not expose password hashes through the Management API. To migrate users without requiring a password reset, you need to request a password hash export from Auth0 support and merge it into your CSV.

If you skip this step, users will need to reset their passwords on first login to WorkOS.

#### Get the Password Export

1. Open a ticket at [Auth0 Support Center](https://support.auth0.com)
2. Request a password hash export for your tenant and database connection
3. Allow 1-7 business days for processing
4. Download the resulting NDJSON file

See [Password Migration Details](#password-migration-details) below for the full process and NDJSON format.

#### Merge into CSV

```bash
npx workos-migrate merge-passwords \
  --csv output/auth0-export.csv \
  --passwords auth0-passwords.ndjson \
  --output output/auth0-with-passwords.csv
```

This command:

- Reads the NDJSON password file
- Matches users by email address (case-insensitive)
- Adds `password_hash` and `password_hash_type` columns to the CSV
- Detects the hash algorithm automatically (typically bcrypt)

### Step 3: Validate CSV

Validate the CSV before importing to catch formatting issues, missing fields, and metadata problems:

```bash
npx workos-migrate validate \
  --csv output/auth0-export.csv \
  --auto-fix
```

The validator checks for:

- Required fields (email)
- Email format validity
- Metadata format (valid JSON, string-only values)
- Reserved field name conflicts in metadata
- Duplicate rows
- Consistent data for users appearing in multiple rows

The `--auto-fix` flag automatically corrects common issues (e.g., metadata value type coercion). See the [CSV Format Guide](CSV-FORMAT.md) for column specifications.

### Step 4: Import to WorkOS

```bash
WORKOS_SECRET_KEY=sk_your_key \
  npx workos-migrate import \
    --csv output/auth0-export.csv
```

#### Pre-Flight Check

Run `--plan` to analyze the CSV and see what would happen without actually importing:

```bash
npx workos-migrate import \
  --csv output/auth0-export.csv \
  --plan
```

This displays a summary of users to create, organizations to resolve, and memberships to establish.

#### Dry Run

Use `--dry-run` to parse and validate the full pipeline without calling WorkOS APIs:

```bash
npx workos-migrate import \
  --csv output/auth0-export.csv \
  --dry-run
```

#### Import Modes

The importer automatically detects the mode based on your CSV content and flags:

**Multi-org mode** (default when CSV contains `org_external_id` columns):

```bash
npx workos-migrate import \
  --csv output/auth0-export.csv
```

Organizations are resolved per-row from the CSV. If a user appears in multiple rows with different `org_external_id` values, they are created once and given a membership in each organization.

**Single-org mode** (all users into one organization):

```bash
npx workos-migrate import \
  --csv output/auth0-export.csv \
  --org-id org_01ABC123
```

Or by external ID:

```bash
npx workos-migrate import \
  --csv output/auth0-export.csv \
  --org-external-id my-org-external-id \
  --create-org-if-missing \
  --org-name "My Organization"
```

**User-only mode** (no organization membership):

If the CSV has no `org_external_id` column and no `--org-id` / `--org-external-id` flags, users are created without any organization membership.

#### Common Import Options

| Flag | Description | Default |
|------|-------------|---------|
| `--csv <path>` | Path to CSV file | Required |
| `--concurrency <n>` | Parallel API requests | 10 |
| `--errors-out <path>` | Write errors to file (.csv or .jsonl) | -- |
| `--dry-run` | Validate only, no API calls | false |
| `--plan` | Display migration plan without importing | false |
| `--quiet` | Suppress per-record output | false |
| `-y, --yes` | Skip interactive prompts | false |

### Step 5: Handle Errors (If Any)

If the import produces errors, analyze them and generate a retry CSV:

```bash
npx workos-migrate analyze \
  --errors output/errors.jsonl \
  --retry-csv output/retry.csv
```

This groups errors by type and produces a CSV containing only the failed rows. You can fix the underlying issues and re-import:

```bash
npx workos-migrate import \
  --csv output/retry.csv
```

---

## Multi-Organization Auth0 Migrations

Auth0's organization system allows users to belong to multiple organizations. The exporter handles this by creating one CSV row per user per organization membership:

```csv
email,first_name,last_name,email_verified,external_id,org_external_id,org_name
alice@example.com,Alice,Smith,true,auth0|123,acme-corp,Acme Corporation
alice@example.com,Alice,Smith,true,auth0|123,beta-inc,Beta Inc
alice@example.com,Alice,Smith,true,auth0|123,gamma-llc,Gamma LLC
```

During import, the first row creates the user and first membership. Subsequent rows detect the duplicate user (by email), reuse the existing user, and create additional memberships. The final result is one user with three organization memberships.

### Organization Discovery Methods

The exporter supports two methods for discovering which organization a user belongs to:

**Method 1: Organizations API (default)**

Uses Auth0's Organizations API to enumerate organizations and their members. This is the recommended approach for Auth0 Enterprise plans that use the Organizations feature.

```bash
npx workos-migrate export-auth0 \
  --domain mycompany.auth0.com \
  --client-id YOUR_CLIENT_ID \
  --client-secret YOUR_CLIENT_SECRET \
  --output output/auth0-export.csv
```

**Method 2: User metadata**

For tenants that store organization information in `user_metadata` (common on non-Enterprise plans), use the `--use-metadata` flag:

```bash
npx workos-migrate export-auth0 \
  --domain mycompany.auth0.com \
  --client-id YOUR_CLIENT_ID \
  --client-secret YOUR_CLIENT_SECRET \
  --output output/auth0-export.csv \
  --use-metadata \
  --metadata-org-id-field company_id \
  --metadata-org-name-field company_name
```

The `--metadata-org-id-field` and `--metadata-org-name-field` flags specify which `user_metadata` fields contain the organization identifier and name. These map to `org_external_id` and `org_name` in the output CSV.

### Pre-Warming for Multi-Org Imports

When using parallel workers (`--workers`) for multi-org imports, a pre-warming phase runs automatically before workers start. This scans the CSV for all unique organizations and resolves or creates them single-threaded, preventing race conditions where multiple workers try to create the same organization simultaneously.

Pre-warming adds approximately 30 seconds for 150 organizations but eliminates nearly all org-resolution errors during import. No additional flags are needed -- it activates automatically when organizations are present in the CSV and workers are enabled.

### org_external_id Mapping

The Auth0 organization ID (e.g., `org_abc123`) is stored as `org_external_id` in WorkOS. This allows you to reference the same organization across systems. When the importer encounters an `org_external_id` that does not yet exist in WorkOS, it creates the organization automatically using the `org_name` from the CSV.

---

## Large-Scale Migrations

For imports with more than 10,000 users, use checkpointing and parallel processing to improve reliability and throughput.

### Checkpointing and Resume

Enable checkpointing with `--job-id` to save progress after each chunk. If the import is interrupted (network failure, crash, manual stop), you can resume from the last completed chunk:

```bash
# Start a checkpointed import
WORKOS_SECRET_KEY=sk_your_key \
  npx workos-migrate import \
    --csv output/auth0-export.csv \
    --job-id auth0-migration-2025-01-15
```

```bash
# Resume after interruption
npx workos-migrate import \
  --resume auth0-migration-2025-01-15
```

#### Chunk Size

Control the number of rows per chunk with `--chunk-size`:

| Chunk Size | Checkpoint Frequency | Max Lost Work on Crash | Best For |
|------------|---------------------|------------------------|----------|
| 500 | Every 500 rows | ~30 seconds | Unstable networks |
| 1000 | Every 1000 rows (default) | ~1 minute | Most cases |
| 5000 | Every 5000 rows | ~5 minutes | Stable, fast networks |

#### Checkpoint Structure

Checkpoints are stored in `.workos-checkpoints/` by default (override with `--checkpoint-dir`):

```
.workos-checkpoints/
  auth0-migration-2025-01-15/
    checkpoint.json    # Job state, progress, org cache
    errors.jsonl       # Streamed error log
```

On resume, the tool validates the CSV has not changed (SHA-256 hash), restores the organization cache, and continues from the next pending chunk.

### Parallel Processing

Use `--workers` to process chunks across multiple threads for up to 4x throughput:

```bash
WORKOS_SECRET_KEY=sk_your_key \
  npx workos-migrate import \
    --csv output/auth0-export.csv \
    --job-id auth0-migration-2025-01-15 \
    --workers 4
```

Workers require `--job-id` for checkpoint coordination.

#### Performance by Worker Count

| Workers | Throughput | 100K Users | 1M Users |
|---------|------------|------------|----------|
| 1 | ~20 users/sec | ~1.4 hours | ~13.9 hours |
| 2 | ~40 users/sec | ~42 min | ~6.9 hours |
| 4 | ~80 users/sec | ~21 min | ~3.5 hours |

Beyond 4 workers, diminishing returns occur due to the shared WorkOS API rate limit (50 requests/second).

#### Memory Usage

Each worker uses approximately 60-90 MB. Memory stays constant regardless of import size:

| Workers | Total Memory | Minimum RAM |
|---------|-------------|-------------|
| 1 | ~150 MB | Any machine |
| 2 | ~270 MB | 512 MB+ |
| 4 | ~480 MB | 1 GB+ |

#### Resuming with Workers

You can resume a job with a different worker count than the original run:

```bash
# Resume with fewer workers if memory is constrained
npx workos-migrate import --resume auth0-migration-2025-01-15 --workers 2
```

### Performance Tuning

Recommended settings by scale:

```bash
# Small imports (<10K users)
npx workos-migrate import \
  --csv output/auth0-export.csv \
  --concurrency 10

# Medium imports (10K-100K users)
npx workos-migrate import \
  --csv output/auth0-export.csv \
  --job-id my-migration \
  --workers 2 \
  --chunk-size 1000 \
  --concurrency 10

# Large imports (100K+ users)
npx workos-migrate import \
  --csv output/auth0-export.csv \
  --job-id my-migration \
  --workers 4 \
  --chunk-size 1000 \
  --concurrency 10 \
  --quiet

# Very large imports (1M+ users)
npx workos-migrate import \
  --csv output/auth0-export.csv \
  --job-id my-migration \
  --workers 4 \
  --chunk-size 5000 \
  --concurrency 15 \
  --quiet
```

Key tuning parameters:

- **`--concurrency`**: Controls parallel API requests per worker. Default 10 is safe for most cases. Going above 20 risks rate limit violations.
- **`--chunk-size`**: Smaller chunks checkpoint more frequently (safer), larger chunks reduce overhead (faster).
- **`--workers`**: Match to roughly half your CPU count, capped at 4 for most workloads.
- **`--quiet`**: Reduces logging overhead in large imports.

---

## Password Migration Details

### Auth0 Support Ticket Process

Auth0 does not expose password hashes through their Management API. To obtain them:

1. Open a ticket at [Auth0 Support Center](https://support.auth0.com)
2. Use this template:

   ```
   Subject: Password Hash Export Request for Migration

   Hello Auth0 Support,

   We are migrating from Auth0 to another identity provider and need to
   export password hashes for our database users to avoid forcing password resets.

   Tenant: [YOUR_TENANT_NAME].auth0.com
   Connection: [YOUR_DATABASE_CONNECTION_NAME]
   Estimated user count: [NUMBER]

   Please provide the password hash export in NDJSON format.

   Thank you!
   ```

3. Auth0 typically responds within 1-2 business days; processing can take up to 1 week
4. Download the file (may be `.ndjson` or `.json.gz` -- extract if compressed with `gunzip`)

**Requirements**: Auth0 paid plan (password exports are not available on free plans). Only database connection users have password hashes; social (Google, GitHub) and enterprise SSO (SAML, OIDC) users do not.

### NDJSON Format Specification

Auth0 provides password exports as newline-delimited JSON. Each line is a complete JSON object:

```json
{"_id":{"$oid":"60425dc43519d90068f82973"},"email":"user@example.com","emailVerified":false,"passwordHash":"$2b$10$Z6hUTEEeoJXN5/AmSm/4.eZ75RYgFVriQM9LPhNEC7kbAbS/VAaJ2","password_set_date":{"$date":"2021-03-05T16:35:16.775Z"},"tenant":"your-tenant","connection":"Username-Password-Authentication"}
```

Key fields:

| Field | Description |
|-------|-------------|
| `_id.$oid` | Auth0 internal user ID (MongoDB format) |
| `email` | User email address |
| `passwordHash` | Bcrypt password hash |
| `password_set_date.$date` | When the password was last set |
| `connection` | Database connection name |

### Bcrypt Hash Format

Auth0 uses bcrypt with the following parameters:

- Algorithm variant: `$2a$` or `$2b$`
- Cost factor (salt rounds): 10

Hash breakdown:

```
$2b$10$Z6hUTEEeoJXN5/AmSm/4.eZ75RYgFVriQM9LPhNEC7kbAbS/VAaJ2
 |   |  |                        |
 |   |  Salt (22 chars)          Hash (31 chars)
 |   Cost factor (2^10 iterations)
 Algorithm variant (bcrypt)
```

These hashes are directly compatible with WorkOS bcrypt import.

### Security Considerations

- Password hash files contain sensitive data. Store them securely and restrict file permissions.
- Use encrypted file systems for temporary storage during migration.
- Delete local copies of password export files after successful import and verification.
- All transfers use HTTPS (Auth0 download link, WorkOS API).
- Bcrypt hashes are one-way cryptographic hashes and cannot be reversed to obtain plain-text passwords.

### Migration Strategies

**With passwords (recommended for minimal disruption)**:

1. Export users from Auth0
2. Request password export from Auth0 support (1-7 days)
3. Merge password hashes into CSV
4. Import to WorkOS
5. Users log in with existing passwords -- no reset required

**Without passwords (simpler process)**:

1. Export users from Auth0
2. Import to WorkOS (no password merge step)
3. Users must reset passwords on first login

The password-free approach is simpler and avoids handling sensitive hash data, but requires all users to take action on first login.

---

## Metadata Handling

### Auth0 Metadata Mapping

The exporter merges Auth0 `user_metadata` and `app_metadata` into a single `metadata` JSON column. It also includes Auth0-specific fields for reference:

```json
{
  "auth0_user_id": "auth0|123456",
  "auth0_created_at": "2024-01-15T10:30:00.000Z",
  "auth0_updated_at": "2024-12-01T14:22:33.000Z",
  "auth0_last_login": "2024-12-03T12:05:30.000Z",
  "auth0_logins_count": "47",
  "department": "Engineering",
  "roles": "[\"admin\",\"developer\"]"
}
```

### WorkOS Metadata Requirements

WorkOS enforces strict metadata validation:

1. **All values must be strings.** The exporter automatically converts booleans, numbers, arrays, and objects to string representations:
   - `true` -> `"true"`
   - `47` -> `"47"`
   - `["admin","developer"]` -> `"[\"admin\",\"developer\"]"`

2. **Reserved field names are renamed.** Fields like `organization_id`, `organization_name`, `org_id`, and `org_name` conflict with WorkOS organization handling. The exporter prefixes these with `auth0_` (e.g., `organization_id` becomes `auth0_organization_id`).

3. **Nested objects are serialized.** Objects and arrays are converted to JSON strings to meet the string-only requirement.

Without this sanitization, WorkOS import fails with `metadata_required` validation errors. The exporter handles all of this automatically.

---

## Example Files

Reference files are available in the `examples/auth0/` directory:

- **`auth0-export-example.csv`** -- Full multi-org export with 15 users across 3 organizations, including metadata with departments, titles, and roles.
- **`auth0-export-sample.csv`** -- Minimal 5-row sample showing the CSV format with password hash columns.
- **`auth-password-hash-export-example.jsonl`** -- Example Auth0 password hash export in NDJSON format, showing the structure you receive from Auth0 support.

---

## Troubleshooting

### Error: "Insufficient scope"

The M2M application is missing required Auth0 Management API permissions.

**Fix**: In Auth0 Dashboard > Applications > Your M2M App > APIs tab > Auth0 Management API > Permissions, enable `read:users`, `read:organizations`, and `read:organization_members`.

### Error: "Connection test failed"

Invalid credentials or network issues.

**Fix**:
- Verify the domain, client ID, and client secret are correct
- Ensure the domain does not include `https://` (use `mycompany.auth0.com`, not `https://mycompany.auth0.com`)
- Test connectivity: `curl https://YOUR_DOMAIN/api/v2/`

### Error: "Rate limit exceeded"

Auth0 API rate limit hit during export.

**Fix**: Set `--rate-limit` to match your Auth0 plan tier. The exporter retries automatically with exponential backoff, but setting the correct limit prevents most 429 errors:

```bash
# Free tier
npx workos-migrate export-auth0 ... --rate-limit 2

# Developer tier (default)
npx workos-migrate export-auth0 ... --rate-limit 50

# Enterprise tier
npx workos-migrate export-auth0 ... --rate-limit 100
```

### Error: "metadata_required"

WorkOS metadata validation failed, usually because metadata contains non-string values or reserved field names.

**Fix**: Re-export with the latest version of the exporter, which automatically sanitizes metadata. If using an existing CSV, run it through the validator with `--auto-fix`:

```bash
npx workos-migrate validate --csv output/auth0-export.csv --auto-fix
```

### Error: "external_id already assigned"

User or organization external IDs already exist in WorkOS from a previous import attempt.

**Fix**: Either delete existing users/organizations from the WorkOS dashboard, or use the `--job-id` and `--resume` flags to continue an interrupted import rather than starting over.

### Warning: "Skipped users without email"

Some Auth0 users do not have an email address. WorkOS requires email, so these users cannot be imported.

**Fix**: Review these users in Auth0 and either add email addresses or exclude them from migration.

### Workers: "Worker exited with code 1"

A worker thread crashed, typically due to insufficient memory.

**Fix**: Reduce the worker count (`--workers 2`) or check available memory. Resume the job to retry failed chunks:

```bash
npx workos-migrate import --resume YOUR_JOB_ID
```

For general issues not specific to Auth0, see the [Troubleshooting Guide](TROUBLESHOOTING.md).
