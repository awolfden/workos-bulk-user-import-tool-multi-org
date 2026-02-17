# Email Deduplication Guide

## Overview

WorkOS requires unique email addresses per user, but source systems like Auth0 can have multiple user records with the same email (different authentication methods). The deduplication feature intelligently merges duplicate email addresses while preserving all metadata and resolving field conflicts.

## Why Deduplication is Needed

### The Problem

**Auth0 Behavior:**
- Allows multiple users with the same email address
- Each authentication method (email/password, Google OAuth, SAML, etc.) creates a separate user record
- Example: `alice@example.com` can exist as:
  - User 1: Email/password authentication
  - User 2: Google OAuth authentication
  - User 3: Microsoft SAML authentication

**WorkOS Behavior:**
- Requires unique email addresses
- Different authentication methods are linked to the same user
- Attempting to import duplicate emails results in API errors: `"email already assigned to another user"`

### The Solution

The deduplication feature automatically:
1. **Detects** duplicate emails during validation
2. **Merges** metadata from all duplicate records
3. **Resolves** field conflicts using intelligent strategies
4. **Generates** a detailed report of all merges

## Usage

### Basic Deduplication

```bash
npx tsx bin/validate-csv.ts \
  --csv users.csv \
  --dedupe \
  --deduped-csv users-deduplicated.csv
```

This will:
- Validate the CSV
- Detect duplicate emails
- Merge them intelligently
- Output a deduplicated CSV
- Generate a deduplication report

### With Auto-Fix

Combine deduplication with auto-fix for best results:

```bash
npx tsx bin/validate-csv.ts \
  --csv users.csv \
  --auto-fix \
  --fixed-csv users-fixed.csv \
  --dedupe \
  --deduped-csv users-ready-for-import.csv
```

This workflow:
1. Validates and fixes common issues (whitespace, boolean formats)
2. Deduplicates emails
3. Produces a clean, import-ready CSV

## Merge Strategies

### Field Resolution

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

Metadata receives special treatment:

**Strategy**: Combine all unique key-value pairs from all duplicate records

**Example**:

Input CSV:
```csv
email,first_name,metadata
alice@example.com,Alice,{"auth_method":"email","source":"import"}
alice@example.com,Alice,{"auth_method":"google","last_login":"2024-01-15"}
```

Merged Result:
```csv
email,first_name,metadata
alice@example.com,Alice,{"auth_method":"email","source":"import","last_login":"2024-01-15"}
```

**Conflict Resolution**:
- If the same metadata key has different values, the **first occurrence** is kept
- Example: `auth_method` has both "email" and "google" → keeps "email"
- All conflicts are reported in the deduplication report

## Deduplication Report

The deduplication report (`deduplication-report.json`) provides complete visibility into the merge process.

### Report Structure

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
  "mergeDetails": [...]
}
```

### Merge Details

For each deduplicated email, the report shows:

```json
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
    },
    {
      "field": "metadata.auth_method",
      "values": ["\"email\"", "\"google\""],
      "chosen": "\"email\"",
      "strategy": "first-occurrence"
    }
  ],
  "metadataMerged": ["auth_method", "source", "last_login"]
}
```

**Fields**:
- `email`: The deduplicated email address
- `duplicateCount`: Number of duplicate records merged
- `mergedRowNumbers`: CSV row numbers that were merged (1-indexed)
- `conflicts`: Fields that had different values across duplicates
- `metadataMerged`: Metadata keys that were combined from all duplicates

## Examples

### Example 1: Auth0 Multi-Auth Users

**Input CSV** (from Auth0 export):
```csv
email,first_name,last_name,email_verified,external_id,metadata
alice@example.com,Alice,Smith,true,auth0|email123,{"auth_method":"email"}
alice@example.com,Alice,Smith,false,auth0|google456,{"auth_method":"google","last_login":"2024-01-15"}
bob@example.com,Bob,Jones,true,auth0|789,{"department":"engineering"}
```

**Command**:
```bash
npx tsx bin/validate-csv.ts \
  --csv auth0-export.csv \
  --dedupe \
  --deduped-csv auth0-ready.csv
```

**Output CSV**:
```csv
email,first_name,last_name,email_verified,external_id,metadata
alice@example.com,Alice,Smith,true,auth0|email123,{"auth_method":"email","last_login":"2024-01-15"}
bob@example.com,Bob,Jones,true,auth0|789,{"department":"engineering"}
```

**Result**:
- ✅ 2 rows merged into 1
- ✅ `email_verified` set to `true` (one record had it as true)
- ✅ Metadata merged: added `last_login` from second record
- ✅ `external_id` conflict: kept first value (auth0|email123)

### Example 2: Multi-Org with Duplicates

**Input CSV**:
```csv
email,first_name,org_external_id,org_name,metadata
alice@example.com,Alice,acme-corp,Acme Corp,{"role":"admin"}
alice@example.com,Alice,acme-corp,Acme Corp,{"department":"sales"}
charlie@example.com,Charlie,beta-inc,Beta Inc,{"role":"user"}
```

**Output CSV**:
```csv
email,first_name,org_external_id,org_name,metadata
alice@example.com,Alice,acme-corp,Acme Corp,{"role":"admin","department":"sales"}
charlie@example.com,Charlie,beta-inc,Beta Inc,{"role":"user"}
```

**Result**:
- ✅ alice@example.com: 2 records merged, metadata combined
- ✅ charlie@example.com: no duplicates, kept as-is

## Best Practices

### 1. Always Review the Deduplication Report

Before importing, review the deduplication report to understand:
- Which emails were deduplicated
- What conflicts were resolved
- What metadata was merged

```bash
cat deduplication-report.json | jq '.mergeDetails'
```

### 2. Use with Validation

Run deduplication as part of your validation workflow:

```bash
# Step 1: Validate and deduplicate
npx tsx bin/validate-csv.ts \
  --csv users.csv \
  --auto-fix \
  --fixed-csv users-fixed.csv \
  --dedupe \
  --deduped-csv users-ready.csv

# Step 2: Review the report
cat deduplication-report.json | jq '.summary'

# Step 3: Import the deduplicated CSV
npx tsx bin/import-users.ts --csv users-ready.csv
```

### 3. Check for Metadata Conflicts

If you have important metadata that shouldn't be lost, review conflicts:

```bash
cat deduplication-report.json | jq '.mergeDetails[].conflicts[] | select(.field | startswith("metadata."))'
```

### 4. Preserve Original CSV

Always keep the original CSV before deduplication:

```bash
# Keep original
cp users.csv users-original.csv

# Deduplicate
npx tsx bin/validate-csv.ts \
  --csv users.csv \
  --dedupe \
  --deduped-csv users-deduplicated.csv
```

## Troubleshooting

### "Duplicate email" Errors During Import

**Problem**: Getting errors like `"email already assigned to another user"` during import.

**Solution**:
```bash
# Run deduplication before import
npx tsx bin/validate-csv.ts \
  --csv users.csv \
  --dedupe \
  --deduped-csv users-clean.csv

# Import the deduplicated CSV
npx tsx bin/import-users.ts --csv users-clean.csv
```

### Important Metadata Being Lost

**Problem**: Deduplication is using "first occurrence" strategy for metadata conflicts, but you want a different value.

**Solution**:
1. Review the deduplication report to identify conflicts
2. Manually edit the CSV to correct any important metadata
3. Alternatively, pre-process your CSV to ensure the desired record appears first

**Example**:
```bash
# Sort CSV to ensure email-verified records come first
sort -t, -k4 -r users.csv > users-sorted.csv

# Then deduplicate the sorted CSV
npx tsx bin/validate-csv.ts \
  --csv users-sorted.csv \
  --dedupe \
  --deduped-csv users-ready.csv
```

### External ID Conflicts

**Problem**: Different `external_id` values for the same email.

**Solution**:
- Review the deduplication report to see which `external_id` was chosen
- Decide if this is acceptable for your use case
- The chosen `external_id` will be used for the merged user in WorkOS

## Integration with Wizard

The migration wizard automatically suggests deduplication when duplicates are detected:

```bash
npx tsx bin/migrate-wizard.ts
```

The wizard will:
1. Detect duplicates during validation
2. Prompt you to deduplicate
3. Automatically merge duplicates
4. Show you the deduplication summary
5. Use the deduplicated CSV for import

## CLI Reference

### Validation with Deduplication

```bash
npx tsx bin/validate-csv.ts \
  --csv <input-csv> \
  --dedupe \
  --deduped-csv <output-csv> \
  [--dedupe-report <report-path>]
```

**Options**:
- `--dedupe`: Enable deduplication
- `--deduped-csv <path>`: Output path for deduplicated CSV (required with --dedupe)
- `--dedupe-report <path>`: Deduplication report path (default: deduplication-report.json)

### Combined Workflow

```bash
npx tsx bin/validate-csv.ts \
  --csv users.csv \
  --auto-fix \
  --fixed-csv users-fixed.csv \
  --dedupe \
  --deduped-csv users-ready.csv \
  --dedupe-report dedupe-report.json \
  --report validation-report.json
```

This produces:
- `users-fixed.csv`: Auto-fixed issues
- `users-ready.csv`: Deduplicated and ready to import
- `dedupe-report.json`: Deduplication details
- `validation-report.json`: Validation summary

## Related Documentation

- [CSV Format Reference](CSV-FORMAT.md) - Supported CSV columns
- [Validation Guide](../phases/02-VALIDATE.md) - CSV validation details
- [Import Phase](../phases/05-IMPORT.md) - Importing deduplicated CSV
- [Troubleshooting](TROUBLESHOOTING.md) - Common errors and solutions
