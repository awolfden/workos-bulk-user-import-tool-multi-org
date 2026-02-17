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
WORKOS_SECRET_KEY=sk_test_123 npx tsx bin/import-users.ts --csv users.csv

# Option 2: .env file
echo 'WORKOS_SECRET_KEY=sk_test_123' > .env
npx tsx bin/import-users.ts --csv users.csv
```

### "Internal Server Error" (HTTP 500)

**Cause:** WorkOS API issues, rate limiting, or API overload

**Solutions:**
```bash
# 1. Resume the import
npx tsx bin/import-users.ts --resume {job-id}

# 2. Use fewer workers
npx tsx bin/import-users.ts --resume {job-id} --workers 2

# 3. Reduce concurrency
npx tsx bin/import-users.ts --resume {job-id} --concurrency 5

# 4. Wait and retry
sleep 60 && npx tsx bin/import-users.ts --resume {job-id}
```

### "External ID already assigned to another organization"

**Cause:** Organization with that `external_id` already exists from previous imports

**Solutions:**

**Option 1: Use fresh test data**
```bash
timestamp=$(date +%s)
# Generate CSV with unique IDs including timestamp
npx tsx bin/import-users.ts --csv fresh-data-${timestamp}.csv
```

**Option 2: Clean up existing data**
- Log into WorkOS dashboard
- Delete test organizations manually
- Re-run import

**Option 3: Use dry-run for testing**
```bash
npx tsx bin/import-users.ts --csv users.csv --dry-run
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
npx tsx bin/validate-csv.ts --csv users.csv --auto-fix --fixed-csv fixed.csv
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
npx tsx bin/import-users.ts --csv users.csv --workers 2

# Check available memory
node -e "console.log((require('os').freemem() / 1024 / 1024).toFixed(0) + ' MB free')"

# Resume (workers will retry failed chunks)
npx tsx bin/import-users.ts --resume {job-id}
```

## Error Analysis

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

## Recovery Workflows

### Resume Failed Import

```bash
# Check checkpoint status
cat .workos-checkpoints/{job-id}/checkpoint.json | jq '.summary'

# Resume from where it stopped
npx tsx bin/import-users.ts --resume {job-id}
```

### Retry with Fewer Workers

```bash
# Original failed with 4 workers
# Retry with 2 workers
npx tsx bin/import-users.ts --resume {job-id} --workers 2
```

### Generate Retry CSV

```bash
# Analyze errors and create retry CSV
npx tsx bin/analyze-errors.ts \
  --errors .workos-checkpoints/{job-id}/errors.jsonl \
  --output retry-analysis.json \
  --retry-csv retry.csv

# Import retry CSV
npx tsx bin/import-users.ts --csv retry.csv
```

## Validation Issues

### Run Validation Before Import

```bash
# Validate CSV
npx tsx bin/validate-csv.ts --csv users.csv

# Auto-fix issues
npx tsx bin/validate-csv.ts \
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
npx tsx bin/import-users.ts --csv users.csv --concurrency 20
```

**Use workers for large imports:**
```bash
# 4 workers = 4x faster
npx tsx bin/import-users.ts \
  --csv users.csv \
  --job-id migration \
  --workers 4
```

### High Memory Usage

**Use chunked mode:**
```bash
# Constant ~100MB memory
npx tsx bin/import-users.ts \
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
npx tsx bin/import-users.ts --csv users.csv --dry-run

# Test with workers
npx tsx bin/import-users.ts \
  --csv users.csv \
  --dry-run \
  --workers 4 \
  --job-id test
```

## Getting Help

- **Error logs**: `.workos-checkpoints/{job-id}/errors.jsonl`
- **Checkpoint**: `.workos-checkpoints/{job-id}/checkpoint.json`
- **Validation**: `npx tsx bin/validate-csv.ts --csv users.csv`
- **Documentation**: [Full Docs](../README.md)
- **Issues**: GitHub Issues
