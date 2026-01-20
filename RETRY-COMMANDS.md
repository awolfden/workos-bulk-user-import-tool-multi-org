# Manual Retry Commands - Quick Reference

## Overview

The wizard and orchestrator tools now display actionable retry commands when imports fail. This guide shows you how to use them.

## Your Current Situation

Based on your migration output, you have:
- **Job ID**: `migration-1768597206636`
- **Errors**: 205 total (203 "retryable", 2 non-retryable)
- **Root Cause**: CSV data validation error - `org_external_id` column contains WorkOS org IDs instead of external IDs

## Understanding Your Errors

### The 203 "Retryable" Errors

**Error Message**: "The external_id provided has already been assigned to another organization."

**What's happening**:
1. Your CSV has `org_external_id` with values like `org_qavBURnvu2Qi22kZ`
2. These are WorkOS **organization IDs**, not external IDs
3. The importer tries to look up the org by external_id → fails (wrong identifier type)
4. Since `org_name` is provided, it tries to create a new org → WorkOS rejects it

**Solution**: Update your CSV to use the `org_id` column instead:

```csv
# INCORRECT (current state):
email,first_name,external_id,org_external_id,org_name
user@test.com,Test,auth0|123,org_qavBURnvu2Qi22kZ,Test Org 19

# CORRECT (what you need):
email,first_name,external_id,org_id
user@test.com,Test,auth0|123,org_qavBURnvu2Qi22kZ
```

### The 2 Non-Retryable Errors

**Email**: `zac.burrage@gmail.com` (records 1-2)

**Error**: "Could not create user."

**Likely causes**:
- Duplicate email (email already exists in WorkOS)
- Invalid user data
- Missing required fields

**Action**: Review the specific error details in the error analysis report and fix the data.

## Retry Commands

### Step 1: Analyze Your Errors

```bash
npx tsx bin/analyze-errors.ts --errors .workos-checkpoints/migration-1768597206636/errors.jsonl
```

This shows:
- Error patterns and counts
- Retryable vs non-retryable breakdown
- Specific recommendations
- **The retry command for your checkpoint**

### Step 2: Fix Your CSV

Before retrying, you MUST fix the data validation errors:

1. Open your CSV file
2. Replace the `org_external_id` column with `org_id`
3. Or use actual external IDs (your system's org identifiers, not WorkOS IDs)
4. Fix the 2 non-retryable user errors for `zac.burrage@gmail.com`

### Step 3: Retry from Checkpoint

After fixing your CSV, resume the migration:

```bash
npx tsx bin/orchestrate-migration.ts \
  --csv users-validated.csv \
  --resume migration-1768597206636 \
  --workers 2
```

This will:
- Resume from the saved checkpoint
- Only retry the 205 failed records
- Skip the successfully imported records
- Use parallel workers for speed

## What Changed in the Tools

### 1. Wizard (`bin/migrate-wizard.ts`)

When the migration completes with errors, you now see:

```
Next steps:
  1. Review errors: cat .workos-checkpoints/migration-1768597206636/errors.jsonl
  2. Analyze errors: npx tsx bin/analyze-errors.ts --errors .workos-checkpoints/...
  3. Fix issues and retry

Retry Commands:

  # Resume from checkpoint (retries failed records):
  npx tsx bin/orchestrate-migration.ts --csv auth0-export.csv --resume migration-1768597206636 --workers 2

  Note: Fix data issues in your CSV before retrying if errors are validation-related.
```

### 2. Orchestrator (`bin/orchestrate-migration.ts`)

When import fails, you see:

```
⚠️  Some imports failed

Next steps:
  1. Review errors: cat .workos-checkpoints/migration-1768597206636/errors.jsonl
  2. Analyze errors: npx tsx bin/analyze-errors.ts --errors ...
  3. Fix issues and retry

Retry Commands:

  # Resume from checkpoint (retries failed records):
  npx tsx bin/orchestrate-migration.ts --csv users.csv --resume migration-1768597206636 --workers 2

  Note: Fix data issues in your CSV before retrying if errors are validation-related.
```

### 3. Error Analyzer (`bin/analyze-errors.ts`)

Enhanced to detect checkpoint mode and provide contextual commands:

```
✓ Analysis complete: 203 error(s) can be retried

To retry failed imports from checkpoint, run:
  npx tsx bin/orchestrate-migration.ts --csv <your-csv> --resume migration-1768597206636

Note: Replace <your-csv> with your original CSV path.
      Fix any data validation issues in your CSV before retrying.
```

## Best Practices

1. **Always analyze errors first** - Use `analyze-errors.ts` to understand what went wrong
2. **Fix data issues before retry** - Most "retryable" errors are actually data validation errors
3. **Use checkpoint resume** - Much faster than re-running the entire import
4. **Keep your original CSV** - You'll need it for the `--resume` command

## Common Retry Scenarios

### Scenario 1: Data Validation Errors (Your Case)

```bash
# 1. Analyze
npx tsx bin/analyze-errors.ts --errors .workos-checkpoints/migration-1768597206636/errors.jsonl

# 2. Fix CSV (change org_external_id to org_id)

# 3. Retry
npx tsx bin/orchestrate-migration.ts --csv users-validated.csv --resume migration-1768597206636 --workers 2
```

### Scenario 2: Transient API Errors

If you had actual transient errors (rate limits, timeouts):

```bash
# Just retry - no CSV fixes needed
npx tsx bin/orchestrate-migration.ts --csv users.csv --resume migration-1768597206636 --workers 2
```

### Scenario 3: Non-Checkpoint Mode

If you didn't use checkpoint mode:

```bash
# Full re-run (will attempt all records again)
npx tsx bin/import-users.ts --csv users.csv --org-id org_123 --concurrency 10
```

## Need More Help?

- Review error details: `cat .workos-checkpoints/migration-1768597206636/errors.jsonl | jq`
- Full error analysis: `cat error-analysis-report.json | jq`
- Check migration summary: `cat migration-summary.json | jq`
