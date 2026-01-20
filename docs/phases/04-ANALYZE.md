# Phase 4: Error Analyzer

Analyze errors.jsonl from failed imports, classify retryability, group by pattern, generate retry CSVs, and get actionable fix suggestions.

## Overview

The Error Analyzer helps you understand and resolve import failures by analyzing the errors.jsonl file generated during failed imports. It classifies errors as retryable or non-retryable, groups them by pattern, and generates retry CSVs for transient failures.

**Key Features:**
- ✅ Streaming JSONL processing (constant memory usage)
- ✅ Retryability classification (8-case decision tree)
- ✅ Pattern-based error grouping
- ✅ Retry CSV generation with deduplication
- ✅ 10 actionable fix suggestion patterns
- ✅ Detailed JSON reports
- ✅ Severity calculation (critical/high/medium/low)
- ✅ Exit codes for automation

---

## Quick Start

### Basic Analysis

Analyze errors and get a summary:

```bash
npx tsx bin/analyze-errors.ts --errors .workos-checkpoints/my-job/errors.jsonl
```

### Generate Retry CSV

Analyze errors and generate a retry CSV for retryable failures:

```bash
npx tsx bin/analyze-errors.ts \
  --errors .workos-checkpoints/my-job/errors.jsonl \
  --retry-csv retry.csv
```

### Full Workflow

Complete error analysis and retry:

```bash
# 1. Analyze errors
npx tsx bin/analyze-errors.ts \
  --errors .workos-checkpoints/my-job/errors.jsonl \
  --retry-csv retry.csv \
  --report error-analysis.json

# 2. Review report and fix non-retryable errors in original CSV

# 3. Retry with generated CSV
npx tsx bin/import-users.ts --csv retry.csv
```

---

## CLI Options

| Option | Description | Required |
|--------|-------------|----------|
| `--errors <path>` | Path to errors.jsonl file | ✅ Yes |
| `--retry-csv <path>` | Output path for retry CSV | No |
| `--report <path>` | JSON report path (default: error-analysis-report.json) | No |
| `--include-duplicates` | Include duplicate emails in retry CSV | No |
| `--quiet` | Suppress progress output | No |

---

## Exit Codes

The analyzer uses exit codes to indicate whether retry is possible:

| Exit Code | Meaning | Description |
|-----------|---------|-------------|
| `0` | Success | Has retryable errors - retry recommended |
| `1` | No retryable errors | All errors require manual CSV fixes |
| `2` | Fatal | File not found, invalid options, or execution error |

**Example automation:**
```bash
# Analyze and check if retry is possible
npx tsx bin/analyze-errors.ts --errors errors.jsonl --retry-csv retry.csv
if [ $? -eq 0 ]; then
  echo "Retrying failed imports..."
  npx tsx bin/import-users.ts --csv retry.csv
else
  echo "Manual review required"
fi
```

---

## Retryability Classification

The analyzer uses an 8-case decision tree to classify errors:

### Retryable Errors

**1. Rate Limiting (HTTP 429)**
- **Reason**: `rate_limit`
- **Strategy**: Retry with backoff (5000ms) or reduced concurrency
- **Example**: "Rate limit exceeded"

**2. Server Errors (HTTP 500+)**
- **Reason**: `server_error`, `user_create_server_error`, `membership_server_error`, `org_resolution_error`
- **Strategy**: Retry immediately or after brief delay
- **Example**: "Internal server error"

**3. Membership Errors (when user created)**
- **Reason**: `membership_error_user_exists`
- **Strategy**: Retry membership creation (user already exists)
- **Condition**: `errorType=membership_create` AND `userId` exists AND not 409
- **Example**: "Failed to create membership (user user_123 created successfully)"

### Non-Retryable Errors

**4. Validation Errors (HTTP 400, 422)**
- **Reason**: `validation_error`, `user_create_validation_error`, `membership_validation_error`
- **Fix**: Review error message and fix CSV data
- **Example**: "Invalid email format", "Missing required field: email"

**5. Conflicts (HTTP 409)**
- **Reason**: `conflict_duplicate`, `membership_duplicate`
- **Fix**: Remove duplicates from CSV
- **Example**: "User already exists", "Membership already exists"

**6. Organization Not Found**
- **Reason**: `org_not_found`
- **Fix**: Add `org_name` column to auto-create orgs or verify org IDs
- **Example**: "Organization org_123 not found"

**7. Unknown Errors (no HTTP status)**
- **Reason**: `unknown_error`
- **Strategy**: Conservative approach - retry by default
- **Fix**: Review error message

---

## Error Grouping

Errors are grouped by normalized pattern, error type, and HTTP status:

### Pattern Normalization

Dynamic values are replaced with placeholders:
- **Emails**: `john@example.com` → `<EMAIL>`
- **User IDs**: `user_01ABC123` → `<USER_ID>`
- **Org IDs**: `org_01ABC123` → `<ORG_ID>`
- **UUIDs**: `123e4567-e89b-12d3-a456-426614174000` → `<UUID>`
- **Numbers**: `42` → `<NUM>`

**Example:**
```
Input:  "Invalid email: john@test.com for user user_01ABC"
Output: "Invalid email: <EMAIL> for user <USER_ID>"
```

### Severity Calculation

Errors are assigned severity levels:

| Severity | Condition |
|----------|-----------|
| **Critical** | HTTP 500+ OR count > 100 |
| **High** | Count > 50 |
| **Medium** | Count > 10 |
| **Low** | Count ≤ 10 |

---

## Fix Suggestions

The analyzer provides actionable suggestions for 10 common error patterns:

### 1. Invalid Email Format
**Pattern**: "invalid email" OR "email format"
**Suggestion**: Fix email addresses in CSV. Ensure all emails match pattern: name@domain.com
**Example**: Change "john.doe" to "john.doe@example.com"
**Actionable**: ✅ Yes

### 2. Missing Required Field
**Pattern**: "missing required" OR "required field"
**Suggestion**: Add missing required fields to CSV rows
**Example**: Add email column or fill empty email cells
**Actionable**: ✅ Yes

### 3. Duplicate User (409)
**Pattern**: HTTP 409 + errorType=user_create
**Suggestion**: Users already exist in WorkOS. Remove duplicates from CSV
**Example**: Remove rows with emails that already exist
**Actionable**: ✅ Yes

### 4. Duplicate Membership (409)
**Pattern**: HTTP 409 + errorType=membership_create
**Suggestion**: Memberships already exist. Remove duplicate org_id/user combinations
**Example**: Ensure each user-org pair appears only once
**Actionable**: ✅ Yes

### 5. Organization Not Found
**Pattern**: errorType=org_resolution + "not found"
**Suggestion**: Verify org_id/org_external_id values or add org_name to create missing orgs
**Example**: Add org_name column with organization names
**Actionable**: ✅ Yes

### 6. Invalid JSON in Metadata
**Pattern**: "invalid json" OR "json"
**Suggestion**: Fix malformed JSON in metadata column
**Example**: Change `{"key":"value}` to `{"key":"value"}`
**Actionable**: ✅ Yes

### 7. Password Hash Incomplete
**Pattern**: "password_hash" AND "type"
**Suggestion**: Add password_hash_type column (e.g., "bcrypt")
**Example**: Add password_hash_type column with value "bcrypt"
**Actionable**: ✅ Yes

### 8. Rate Limiting (429)
**Pattern**: HTTP 429
**Suggestion**: Reduce --concurrency value (try 5 or lower) and retry
**Example**: `npx tsx bin/import-users.ts --csv retry.csv --concurrency 5`
**Actionable**: ❌ No (requires config change)

### 9. Server Errors (500+)
**Pattern**: HTTP 500+
**Suggestion**: Wait a few minutes and retry with generated retry CSV
**Example**: Wait 5-10 minutes, then run import
**Actionable**: ❌ No (requires wait)

### 10. Validation Errors (400, 422)
**Pattern**: HTTP 400 or 422
**Suggestion**: Review error message and fix data in CSV
**Example**: Check error examples in report for specific field issues
**Actionable**: ✅ Yes

---

## Retry CSV Generation

### Deduplication

By default, the retry CSV deduplicates by email (keeps first occurrence):

```bash
# Generate retry CSV (deduplicated)
npx tsx bin/analyze-errors.ts \
  --errors errors.jsonl \
  --retry-csv retry.csv
```

**Result**: 1000 errors → 850 unique emails → 850 rows in retry.csv

### Include Duplicates

To include all retryable errors (even duplicates):

```bash
npx tsx bin/analyze-errors.ts \
  --errors errors.jsonl \
  --retry-csv retry.csv \
  --include-duplicates
```

**Result**: 1000 errors → 1000 rows in retry.csv

### Column Ordering

Retry CSVs preserve the original column order from the source CSV, with standard WorkOS columns first:
1. `email`
2. `password` / `password_hash` / `password_hash_type`
3. `first_name` / `last_name`
4. `email_verified` / `external_id` / `metadata`
5. `org_id` / `org_external_id` / `org_name`
6. Custom columns (in original order)

---

## JSON Report Format

The analyzer generates a comprehensive JSON report:

```json
{
  "summary": {
    "totalErrors": 1000,
    "retryableErrors": 650,
    "nonRetryableErrors": 350,
    "uniqueEmails": 850,
    "uniqueErrorPatterns": 12,
    "errorsByType": {
      "user_create": 600,
      "membership_create": 300,
      "org_resolution": 100
    },
    "errorsByStatus": {
      "400": 200,
      "409": 150,
      "500": 650
    }
  },
  "groups": [
    {
      "id": "user_create-400-invalid-email-format-for-email",
      "pattern": "Invalid email format for <EMAIL>",
      "errorType": "user_create",
      "httpStatus": 400,
      "count": 200,
      "severity": "critical",
      "retryable": false,
      "examples": [
        {
          "recordNumber": 5,
          "email": "invalid-email",
          "errorMessage": "Invalid email format for invalid-email",
          "timestamp": "2024-01-01T12:00:00Z"
        }
      ],
      "affectedEmails": ["user1@example.com", "user2@example.com"]
    }
  ],
  "retryability": {
    "retryable": {
      "count": 650,
      "percentage": 65.0,
      "byReason": {
        "server_error": 500,
        "rate_limit": 150
      }
    },
    "nonRetryable": {
      "count": 350,
      "percentage": 35.0,
      "byReason": {
        "validation_error": 200,
        "conflict_duplicate": 150
      }
    }
  },
  "suggestions": [
    {
      "groupId": "user_create-400-invalid-email-format-for-email",
      "pattern": "Invalid email format for <EMAIL>",
      "severity": "critical",
      "affectedCount": 200,
      "suggestion": "Fix email addresses in CSV. Ensure all emails match pattern: name@domain.com",
      "actionable": true,
      "exampleFix": "Change \"john.doe\" to \"john.doe@example.com\""
    }
  ],
  "timestamp": "2024-01-01T12:00:00Z",
  "errorsFile": ".workos-checkpoints/my-job/errors.jsonl",
  "errorsFileHash": "abc123def456"
}
```

---

## Console Output Example

```
============================================================
ERROR ANALYSIS SUMMARY
============================================================
Total errors:          1000
Retryable errors:      650 (65.0%)
Non-retryable errors:  350 (35.0%)
Unique emails:         850
Error patterns:        12
============================================================

Top Error Groups:
  [CRITICAL] [NON-RETRYABLE] Invalid email format for <EMAIL> (200 errors)
  [HIGH] [RETRYABLE] Internal server error (500 errors)
  [MEDIUM] [NON-RETRYABLE] User <EMAIL> already exists (150 errors)

Retryable Error Reasons:
  • server_error: 500
  • rate_limit: 150

Non-Retryable Error Reasons:
  • validation_error: 200
  • conflict_duplicate: 150

Actionable Fix Suggestions:

  Invalid email format for <EMAIL> (200 errors)
  → Fix email addresses in CSV. Ensure all emails match pattern: name@domain.com
    Example: Change "john.doe" to "john.doe@example.com"

  User <EMAIL> already exists (150 errors)
  → Users already exist in WorkOS. Remove duplicates from CSV or skip these rows.
    Example: Remove rows with emails that already exist in WorkOS

============================================================
Full report:           error-analysis-report.json
Retry CSV:             retry.csv
============================================================

✓ Analysis complete: 650 error(s) can be retried

To retry failed imports, run:
  npx tsx bin/import-users.ts --csv retry.csv
```

---

## Performance

The analyzer uses streaming architecture for constant memory usage:

| Dataset | Time | Memory | Throughput |
|---------|------|--------|------------|
| 10K errors | <5s | <100MB | 2000 errors/s |
| 100K errors | <30s | <200MB | 3300 errors/s |
| 1M errors | <5min | <500MB | 3300 errors/s |

**Memory Breakdown:**
- JSONL streaming: O(1) for file reading
- Error grouping: O(m) where m = unique patterns (~10-50 typically)
- Total: ~100MB for 100K errors

---

## Integration with Import Tool

The analyzer works seamlessly with the import tool:

### 1. Import with Checkpoint

```bash
npx tsx bin/import-users.ts \
  --csv users.csv \
  --job-id my-import \
  --errors-out .workos-checkpoints/my-import/errors.jsonl
```

### 2. Analyze Errors

```bash
npx tsx bin/analyze-errors.ts \
  --errors .workos-checkpoints/my-import/errors.jsonl \
  --retry-csv retry.csv \
  --report analysis.json
```

### 3. Fix Non-Retryable Errors

Review `analysis.json` and fix validation errors in original CSV.

### 4. Retry

```bash
# Retry transient failures
npx tsx bin/import-users.ts --csv retry.csv

# Or resume original import (if using checkpoint)
npx tsx bin/import-users.ts --resume my-import
```

---

## Troubleshooting

### "No retryable errors found"

All errors require manual CSV fixes. Review the fix suggestions in the report.

**Common causes:**
- Invalid email formats (fix emails in CSV)
- Missing required fields (add fields to CSV)
- Duplicate users (remove duplicates or use different org_id)
- Organizations not found (add org_name column or verify org IDs)

### "Error: Errors file not found"

The errors.jsonl file doesn't exist at the specified path.

**Fix:**
- Check the checkpoint directory: `.workos-checkpoints/{job-id}/errors.jsonl`
- Ensure the import was run with `--errors-out` flag
- Verify the file path is correct

### "Retry CSV is empty"

No retryable errors with valid rawRow data found.

**Possible reasons:**
- All errors are validation errors (non-retryable)
- Errors occurred before CSV parsing (no rawRow data)
- All retryable errors already resolved

**Fix:**
- Review the analysis report for error types
- Fix validation errors in original CSV
- Check if errors occurred during file reading vs import

---

## Examples

### Example 1: Server Errors Only

All errors are server errors (retryable):

```bash
$ npx tsx bin/analyze-errors.ts --errors errors.jsonl --retry-csv retry.csv

Total errors:          500
Retryable errors:      500 (100.0%)
Non-retryable errors:  0 (0.0%)

✓ Analysis complete: 500 error(s) can be retried
  npx tsx bin/import-users.ts --csv retry.csv
```

Exit code: `0`

### Example 2: Validation Errors Only

All errors are validation errors (non-retryable):

```bash
$ npx tsx bin/analyze-errors.ts --errors errors.jsonl --retry-csv retry.csv

Total errors:          200
Retryable errors:      0 (0.0%)
Non-retryable errors:  200 (100.0%)

⚠️  No retryable errors found
Review the fix suggestions above and the full report for details.
```

Exit code: `1`

### Example 3: Mixed Errors

Mix of retryable and non-retryable errors:

```bash
$ npx tsx bin/analyze-errors.ts --errors errors.jsonl --retry-csv retry.csv

Total errors:          1000
Retryable errors:      650 (65.0%)
Non-retryable errors:  350 (35.0%)

✓ Analysis complete: 650 error(s) can be retried
  npx tsx bin/import-users.ts --csv retry.csv
```

Exit code: `0` (has retryable errors)

---

## Advanced Usage

### Batch Analysis

Analyze multiple error files:

```bash
for errors in .workos-checkpoints/*/errors.jsonl; do
  job_id=$(basename $(dirname $errors))
  npx tsx bin/analyze-errors.ts \
    --errors "$errors" \
    --retry-csv "retry-${job_id}.csv" \
    --report "analysis-${job_id}.json" \
    --quiet
done
```

### CI/CD Integration

```bash
#!/bin/bash
set -e

# Import users
npx tsx bin/import-users.ts --csv users.csv --errors-out errors.jsonl || true

# Check if errors occurred
if [ -f errors.jsonl ]; then
  # Analyze errors
  npx tsx bin/analyze-errors.ts --errors errors.jsonl --retry-csv retry.csv --quiet

  # Exit code 0 = has retryable errors, 1 = no retryable errors
  if [ $? -eq 0 ]; then
    echo "Retrying failed imports..."
    npx tsx bin/import-users.ts --csv retry.csv
  else
    echo "Manual review required - check analysis report"
    exit 1
  fi
fi
```

### Automated Retry Loop

```bash
#!/bin/bash

MAX_RETRIES=3
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
  npx tsx bin/import-users.ts --csv users.csv --errors-out errors.jsonl

  if [ ! -f errors.jsonl ] || [ ! -s errors.jsonl ]; then
    echo "Success! No errors."
    exit 0
  fi

  npx tsx bin/analyze-errors.ts --errors errors.jsonl --retry-csv retry.csv --quiet
  if [ $? -ne 0 ]; then
    echo "No retryable errors - stopping"
    exit 1
  fi

  RETRY_COUNT=$((RETRY_COUNT + 1))
  echo "Retry attempt $RETRY_COUNT of $MAX_RETRIES..."
  cp retry.csv users.csv
  rm errors.jsonl
done

echo "Max retries exceeded"
exit 1
```

---

## Next Steps

After analyzing errors:

1. **For Retryable Errors**: Use the generated retry CSV with the import tool
2. **For Non-Retryable Errors**: Review fix suggestions and update your source CSV
3. **For Mixed Errors**: Fix non-retryable errors in source CSV, then retry both

**Recommended workflow:**
```bash
# 1. Validate CSV before import (Phase 2)
npx tsx bin/validate-csv.ts --csv users.csv --auto-fix --fixed-csv users-fixed.csv

# 2. Import users (Phase 1)
npx tsx bin/import-users.ts --csv users-fixed.csv --errors-out errors.jsonl

# 3. If errors occur, analyze (Phase 4)
npx tsx bin/analyze-errors.ts --errors errors.jsonl --retry-csv retry.csv

# 4. Retry transient failures
npx tsx bin/import-users.ts --csv retry.csv
```
