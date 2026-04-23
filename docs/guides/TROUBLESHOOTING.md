# Troubleshooting Guide

Common errors and solutions for the WorkOS Migration Toolkit.

## Quick Diagnostics

```bash
# Count total errors
wc -l .workos-checkpoints/{job-id}/errors.jsonl

# Group errors by type
cat .workos-checkpoints/{job-id}/errors.jsonl | jq -r .errorType | sort | uniq -c

# Most common error messages
cat .workos-checkpoints/{job-id}/errors.jsonl | jq -r .errorMessage | sort | uniq -c | sort -rn | head -5
```

## Common Errors

### "WORKOS_SECRET_KEY is missing"

**Cause:** Environment variable not set

**Solution:**
```bash
# Option 1: Inline
WORKOS_SECRET_KEY=sk_test_123 npx workos-migrate import --csv users.csv

# Option 2: .env file
echo 'WORKOS_SECRET_KEY=sk_test_123' > .env
npx workos-migrate import --csv users.csv
```

### "Internal Server Error" (HTTP 500)

**Cause:** WorkOS API issues, rate limiting, or API overload

**Solutions:**
```bash
# 1. Resume the import
npx workos-migrate import --resume {job-id}

# 2. Use fewer workers
npx workos-migrate import --resume {job-id} --workers 2

# 3. Reduce concurrency
npx workos-migrate import --resume {job-id} --concurrency 5

# 4. Wait and retry
sleep 60 && npx workos-migrate import --resume {job-id}
```

### "External ID already assigned to another organization"

**Cause:** Organization with that `external_id` already exists from previous imports

**Solutions:**

**Option 1: Use fresh test data**
```bash
timestamp=$(date +%s)
# Generate CSV with unique IDs including timestamp
npx workos-migrate import --csv fresh-data-${timestamp}.csv
```

**Option 2: Clean up existing data**
- Log into WorkOS dashboard
- Delete test organizations manually
- Re-run import

**Option 3: Use dry-run for testing**
```bash
npx workos-migrate import --csv users.csv --dry-run
```

### "Email already exists"

**Cause:** User with this email already exists in WorkOS

**Solutions:**
```bash
# Skip duplicate emails by using unique test emails
# Or view which emails are duplicates:
cat .workos-checkpoints/{job-id}/errors.jsonl | \
  jq 'select(.errorMessage | contains("Email already exists")) | .email'
```

### "Organization not found"

**Cause:** Organization doesn't exist for given `org_external_id`

**Solutions:**
```bash
# Option 1: Add org_name column to create orgs
# CSV should have: org_external_id,org_name
# acme-corp,Acme Corporation

# Option 2: Pre-create organizations in WorkOS dashboard

# Option 3: Use org_id instead (direct ID, no lookup)
```

### "Metadata is invalid JSON"

**Cause:** Invalid JSON syntax in metadata column

**Solution:**
- Use double quotes (not single quotes)
- Validate JSON: https://jsonlint.com
- Auto-fix with validator:

```bash
npx workos-migrate validate --csv users.csv --auto-fix --fixed-csv fixed.csv
```

### Worker Errors

**"Worker exited with code 1"**

**Causes:**
- Insufficient memory
- Worker crash
- API errors

**Solutions:**
```bash
# Reduce workers
npx workos-migrate import --csv users.csv --workers 2

# Check available memory
node -e "console.log((require('os').freemem() / 1024 / 1024).toFixed(0) + ' MB free')"

# Resume (workers will retry failed chunks)
npx workos-migrate import --resume {job-id}
```

## Error Analysis

Analyze errors from failed imports, classify retryability, group by pattern, generate retry CSVs, and get actionable fix suggestions.

### Running the Analyzer

```bash
# Basic analysis
npx workos-migrate analyze --errors .workos-checkpoints/my-job/errors.jsonl

# Generate retry CSV
npx workos-migrate analyze \
  --errors .workos-checkpoints/my-job/errors.jsonl \
  --retry-csv retry.csv

# Full analysis with report
npx workos-migrate analyze \
  --errors .workos-checkpoints/my-job/errors.jsonl \
  --retry-csv retry.csv \
  --report error-analysis.json
```

### Analyzer CLI Options

| Option | Description | Required |
|--------|-------------|----------|
| `--errors <path>` | Path to errors.jsonl file | Yes |
| `--retry-csv <path>` | Output path for retry CSV | No |
| `--report <path>` | JSON report path (default: error-analysis-report.json) | No |
| `--include-duplicates` | Include duplicate emails in retry CSV | No |
| `--quiet` | Suppress progress output | No |

### Exit Codes

The analyzer uses exit codes to indicate whether retry is possible:

| Exit Code | Meaning | Description |
|-----------|---------|-------------|
| `0` | Success | Has retryable errors -- retry recommended |
| `1` | No retryable errors | All errors require manual CSV fixes |
| `2` | Fatal | File not found, invalid options, or execution error |

**Example automation:**
```bash
# Analyze and check if retry is possible
npx workos-migrate analyze --errors errors.jsonl --retry-csv retry.csv
if [ $? -eq 0 ]; then
  echo "Retrying failed imports..."
  npx workos-migrate import --csv retry.csv
else
  echo "Manual review required"
fi
```

### Retryability Classification

The analyzer uses an 8-case decision tree to classify errors:

**Retryable errors:**

1. **Rate Limiting (HTTP 429)** -- Retry with backoff (5000ms) or reduced concurrency
2. **Server Errors (HTTP 500+)** -- Retry immediately or after brief delay
3. **Membership Errors (when user created)** -- Retry membership creation (user already exists). Condition: `errorType=membership_create` AND `userId` exists AND not 409

**Non-retryable errors:**

4. **Validation Errors (HTTP 400, 422)** -- Review error message and fix CSV data
5. **Conflicts (HTTP 409)** -- Remove duplicates from CSV
6. **Organization Not Found** -- Add `org_name` column to auto-create orgs or verify org IDs
7. **Unknown Errors (no HTTP status)** -- Conservative approach: retry by default

### Pattern Grouping

Errors are grouped by normalized pattern, error type, and HTTP status. Dynamic values are replaced with placeholders:

- **Emails:** `john@example.com` becomes `<EMAIL>`
- **User IDs:** `user_01ABC123` becomes `<USER_ID>`
- **Org IDs:** `org_01ABC123` becomes `<ORG_ID>`
- **UUIDs:** `123e4567-e89b-12d3-a456-426614174000` becomes `<UUID>`

Severity levels are assigned based on count and HTTP status:

| Severity | Condition |
|----------|-----------|
| **Critical** | HTTP 500+ OR count > 100 |
| **High** | Count > 50 |
| **Medium** | Count > 10 |
| **Low** | Count <= 10 |

### Retry CSV Generation

By default, the retry CSV deduplicates by email (keeps first occurrence):

```bash
# Generate retry CSV (deduplicated)
npx workos-migrate analyze \
  --errors errors.jsonl \
  --retry-csv retry.csv
```

To include all retryable errors (even duplicates):

```bash
npx workos-migrate analyze \
  --errors errors.jsonl \
  --retry-csv retry.csv \
  --include-duplicates
```

Retry CSVs preserve the original column order from the source CSV, with standard WorkOS columns first.

### Fix Suggestion Patterns

The analyzer provides actionable suggestions for common error patterns:

| Pattern | Suggestion |
|---------|------------|
| Invalid email format | Fix email addresses in CSV |
| Missing required field | Add missing required fields to CSV rows |
| Duplicate user (409) | Remove duplicates from CSV |
| Duplicate membership (409) | Remove duplicate org/user combinations |
| Organization not found | Add `org_name` column or verify org IDs |
| Invalid JSON in metadata | Fix malformed JSON in metadata column |
| Password hash without type | Add `password_hash_type` column |
| Rate limiting (429) | Reduce `--concurrency` value and retry |
| Server errors (500+) | Wait a few minutes and retry |
| Validation errors (400, 422) | Review error message and fix data in CSV |

### Full Error Analysis Workflow

```bash
# 1. Import users
npx workos-migrate import \
  --csv users.csv \
  --job-id my-import \
  --errors-out .workos-checkpoints/my-import/errors.jsonl

# 2. Analyze errors
npx workos-migrate analyze \
  --errors .workos-checkpoints/my-import/errors.jsonl \
  --retry-csv retry.csv \
  --report analysis.json

# 3. Fix non-retryable errors in original CSV based on analysis.json

# 4. Retry transient failures
npx workos-migrate import --csv retry.csv

# Or resume original import (if using checkpoint)
npx workos-migrate import --resume my-import
```

### View Errors by Type

```bash
# Count each error type
cat .workos-checkpoints/{job-id}/errors.jsonl | \
  jq -r .errorType | sort | uniq -c

# Example output:
#   150 user_create
#    25 org_resolution
#     8 membership_create
```

### Filter Specific Errors

```bash
# View only org_resolution errors
cat .workos-checkpoints/{job-id}/errors.jsonl | \
  jq 'select(.errorType == "org_resolution")'

# View only HTTP 409 conflicts
cat .workos-checkpoints/{job-id}/errors.jsonl | \
  jq 'select(.httpStatus == 409)'
```

### Extract Failed Emails

```bash
# Get list of failed emails
cat .workos-checkpoints/{job-id}/errors.jsonl | \
  jq -r .email > failed-emails.txt
```

## Email Deduplication

WorkOS requires unique email addresses per user, but source systems like Auth0 can have multiple user records with the same email (different authentication methods). The deduplication feature intelligently merges duplicate email addresses while preserving all metadata and resolving field conflicts.

### Why Deduplication is Needed

**Auth0 behavior:** Allows multiple users with the same email address. Each authentication method (email/password, Google OAuth, SAML, etc.) creates a separate user record. For example, `alice@example.com` can exist as three separate records for email/password, Google OAuth, and Microsoft SAML.

**WorkOS behavior:** Requires unique email addresses. Different authentication methods are linked to the same user. Attempting to import duplicate emails results in API errors: `"email already assigned to another user"`.

### Running Deduplication

```bash
# Basic deduplication
npx workos-migrate validate \
  --csv users.csv \
  --dedupe \
  --deduped-csv users-deduplicated.csv

# Combined with auto-fix for best results
npx workos-migrate validate \
  --csv users.csv \
  --auto-fix \
  --fixed-csv users-fixed.csv \
  --dedupe \
  --deduped-csv users-ready-for-import.csv
```

This will:
- Validate the CSV
- Detect duplicate emails
- Merge them intelligently
- Output a deduplicated CSV
- Generate a deduplication report

### Deduplication CLI Options

- `--dedupe` -- Enable deduplication
- `--deduped-csv <path>` -- Output path for deduplicated CSV (required with `--dedupe`)
- `--dedupe-report <path>` -- Deduplication report path (default: `deduplication-report.json`)

### Merge Strategies

When duplicate emails are found, the deduplication logic uses these strategies:

| Field | Strategy | Description |
|-------|----------|-------------|
| `email_verified` | **true-if-any** | If ANY duplicate has `email_verified=true`, the merged record gets `true` |
| `first_name` | **first-non-empty** | Uses the first non-empty value encountered |
| `last_name` | **first-non-empty** | Uses the first non-empty value encountered |
| `external_id` | **first-non-empty** | Uses the first non-empty value encountered |
| `password_hash` | **first-non-empty** | Uses the first non-empty value encountered |
| `password_hash_type` | **first-non-empty** | Uses the first non-empty value encountered |
| `org_id` | **first-non-empty** | Uses the first non-empty value encountered |
| `org_external_id` | **first-non-empty** | Uses the first non-empty value encountered |
| `org_name` | **first-non-empty** | Uses the first non-empty value encountered |
| `metadata` | **merge-all** | Combines all unique key-value pairs from all duplicates |

### Metadata Merging

Metadata receives special treatment: all unique key-value pairs from all duplicate records are combined.

**Example input:**
```csv
email,first_name,metadata
alice@example.com,Alice,{"auth_method":"email","source":"import"}
alice@example.com,Alice,{"auth_method":"google","last_login":"2024-01-15"}
```

**Merged result:**
```csv
email,first_name,metadata
alice@example.com,Alice,{"auth_method":"email","source":"import","last_login":"2024-01-15"}
```

**Conflict resolution:** If the same metadata key has different values, the first occurrence is kept. For example, `auth_method` has both "email" and "google" -- the merged record keeps "email". All conflicts are reported in the deduplication report.

### Deduplication Report

The deduplication report (`deduplication-report.json`) provides complete visibility into the merge process:

```json
{
  "timestamp": "2026-01-21T18:48:30.215Z",
  "csvPath": "/path/to/input.csv",
  "summary": {
    "totalInputRows": 7,
    "uniqueRows": 4,
    "duplicatesFound": 2,
    "rowsRemoved": 3
  },
  "mergeDetails": [
    {
      "email": "alice@example.com",
      "duplicateCount": 2,
      "mergedRowNumbers": [2, 3],
      "conflicts": [
        {
          "field": "last_name",
          "values": ["Smith", "Smith-Jones"],
          "chosen": "Smith",
          "strategy": "first-non-empty"
        }
      ],
      "metadataMerged": ["auth_method", "source", "last_login"]
    }
  ]
}
```

### Deduplication Best Practices

1. **Always review the deduplication report** before importing to understand which emails were deduplicated, what conflicts were resolved, and what metadata was merged
2. **Combine with validation** -- run deduplication as part of your validation workflow
3. **Check for metadata conflicts** -- if you have important metadata that should not be lost, review conflicts in the report
4. **Preserve original CSV** -- always keep the original CSV before deduplication

### Deduplication Troubleshooting

**"Duplicate email" errors during import:** Run deduplication before import:
```bash
npx workos-migrate validate \
  --csv users.csv \
  --dedupe \
  --deduped-csv users-clean.csv

npx workos-migrate import --csv users-clean.csv
```

**Important metadata being lost:** The "first occurrence" strategy is used for metadata conflicts. To control which record wins, sort your CSV so the preferred record appears first, then run deduplication.

**External ID conflicts:** Different `external_id` values for the same email are resolved by keeping the first occurrence. Review the deduplication report to verify the chosen value is acceptable.

## Recovery Workflows

### Resume Failed Import

```bash
# Check checkpoint status
cat .workos-checkpoints/{job-id}/checkpoint.json | jq '.summary'

# Resume from where it stopped
npx workos-migrate import --resume {job-id}
```

### Retry with Fewer Workers

```bash
# Original failed with 4 workers
# Retry with 2 workers
npx workos-migrate import --resume {job-id} --workers 2
```

### Generate Retry CSV

```bash
# Analyze errors and create retry CSV
npx workos-migrate analyze \
  --errors .workos-checkpoints/{job-id}/errors.jsonl \
  --output retry-analysis.json \
  --retry-csv retry.csv

# Import retry CSV
npx workos-migrate import --csv retry.csv
```

## Validation Issues

### Run Validation Before Import

```bash
# Validate CSV
npx workos-migrate validate --csv users.csv

# Auto-fix issues
npx workos-migrate validate \
  --csv users.csv \
  --auto-fix \
  --fixed-csv users-fixed.csv
```

### Common Validation Errors

**Missing required column (email)**
- Add `email` column to CSV

**Invalid email format**
- Check email format in rows

**Invalid JSON in metadata**
- Use double quotes
- Validate at jsonlint.com
- Use auto-fix

**Both org_id and org_external_id in same row**
- Choose one column, remove the other

## Performance Issues

### Import Too Slow

**Check concurrency:**
```bash
# Increase from default 10 to 20
npx workos-migrate import --csv users.csv --concurrency 20
```

**Use workers for large imports:**
```bash
# 4 workers = 4x faster
npx workos-migrate import \
  --csv users.csv \
  --job-id migration \
  --workers 4
```

### High Memory Usage

**Use chunked mode:**
```bash
# Constant ~100MB memory
npx workos-migrate import \
  --csv users.csv \
  --job-id migration \
  --chunk-size 1000
```

**Reduce workers:**
```bash
# Each worker uses ~60-90MB
--workers 2  # Instead of 4
```

## Dry-Run Testing

Always test before production:

```bash
# Test without API calls
npx workos-migrate import --csv users.csv --dry-run

# Test with workers
npx workos-migrate import \
  --csv users.csv \
  --dry-run \
  --workers 4 \
  --job-id test
```

## Getting Help

- **Error logs**: `.workos-checkpoints/{job-id}/errors.jsonl`
- **Checkpoint**: `.workos-checkpoints/{job-id}/checkpoint.json`
- **Validation**: `npx workos-migrate validate --csv users.csv`
- **Error analysis**: `npx workos-migrate analyze --errors errors.jsonl`
- **Wizard**: `npx workos-migrate wizard`

## Related Documentation

- [CSV Format Reference](CSV-FORMAT.md) - CSV column reference and metadata rules
- [Role Mapping Guide](ROLE-MAPPING.md) - Role and permission migration
- [Clerk Migration](CLERK-MIGRATION.md) - Clerk-specific migration guide
- [Firebase Migration](FIREBASE-MIGRATION.md) - Firebase migration guide
- [Custom CSV Import](CUSTOM-CSV-IMPORT.md) - Generic CSV import guide
- [Wizard Guide](WIZARD.md) - Interactive wizard walkthrough
