# Phase 2: CSV Validator

Pre-flight validation of CSV files before importing to WorkOS. Detects errors, duplicates, and auto-fixes common issues.

## Overview

The CSV validator provides comprehensive validation of user import files **before** you attempt to import them to WorkOS. This helps catch errors early and ensures smooth imports.

**Key Features:**
- ✅ 11 validation rules across 3 categories (header, row, duplicate)
- ✅ Auto-fix for common issues (whitespace, boolean values, metadata arrays/objects)
- ✅ Duplicate email and external_id detection
- ✅ Mode detection (single-org, multi-org, user-only)
- ✅ Streaming architecture (constant memory for any CSV size)
- ✅ JSON validation reports
- ✅ Fixed CSV output
- ✅ Exit codes for CI/CD integration

---

## Quick Start

### Basic Validation

Validate a CSV file and get a report:

```bash
npx tsx bin/validate-csv.ts --csv users.csv
```

### Auto-fix Common Issues

Fix whitespace and boolean formatting issues:

```bash
npx tsx bin/validate-csv.ts \
  --csv users.csv \
  --auto-fix \
  --fixed-csv users-fixed.csv
```

### Full Report

Generate a detailed JSON report:

```bash
npx tsx bin/validate-csv.ts \
  --csv users.csv \
  --report validation-report.json
```

---

## CLI Options

| Option | Description | Required |
|--------|-------------|----------|
| `--csv <path>` | CSV file to validate | ✅ Yes |
| `--auto-fix` | Auto-fix common issues | No |
| `--fixed-csv <path>` | Output path for fixed CSV (requires --auto-fix) | No |
| `--report <path>` | JSON report path (default: validation-report.json) | No |
| `--check-api` | Check WorkOS API for conflicts (requires WORKOS_SECRET_KEY) | No |
| `--quiet` | Suppress progress output | No |

---

## Exit Codes

The validator uses standard exit codes for CI/CD integration:

| Exit Code | Meaning | Description |
|-----------|---------|-------------|
| `0` | Valid | No errors found (warnings are OK) |
| `1` | Invalid | Errors found in CSV |
| `2` | Fatal | Bad options, file not found, or execution error |

**Example CI/CD usage:**
```bash
# Validate before import
npx tsx bin/validate-csv.ts --csv users.csv || exit 1

# Import if validation passed
npx tsx bin/import-users.ts --csv users.csv
```

---

## Validation Rules

### Header Rules (3 rules)

**1. required-email-column** (error)
- Email column must be present
- Example: CSV with columns `first_name,last_name` → Error

**2. unknown-columns** (warning)
- Warns about columns not recognized by WorkOS
- Known columns: `email`, `password`, `password_hash`, `password_hash_type`, `first_name`, `last_name`, `email_verified`, `external_id`, `metadata`, `org_id`, `org_external_id`, `org_name`

**3. mode-detection** (info)
- Detects import mode based on columns present
- Modes: `single-org`, `multi-org`, `user-only`

### Row Rules (8 rules)

**4. required-email** (error)
- Each row must have a non-empty email
- Example: Row with blank email → Error

**5. email-format** (error)
- Email must contain @ symbol
- Example: `invalid-email` → Error
- Example: `alice@example.com` → Valid

**6. email-whitespace** (warning, auto-fixable)
- Email should not have leading/trailing whitespace
- Example: ` alice@example.com ` → Warning
- Auto-fix: ` alice@example.com ` → `alice@example.com`

**7. metadata-json** (error)
- Metadata field must be valid JSON if present
- Example: `{invalid json}` → Error
- Example: `{"department":"Engineering"}` → Valid

**7b. metadata-arrays-objects** (warning, auto-fixable)
- Metadata values should be primitives (strings, numbers, booleans)
- WorkOS does not support arrays or nested objects in metadata
- Auto-fix: Converts arrays/objects to JSON strings
- Example: `{"permissions":["read","write"]}` → `{"permissions":"[\"read\",\"write\"]"}`
- **Why this matters**: Prevents import failures with misleading "metadata_required" errors

**8. org-id-conflict** (error)
- Row cannot have both `org_id` and `org_external_id`
- These are mutually exclusive identifiers

**9. boolean-format** (warning, auto-fixable)
- Boolean fields should use valid values
- Valid: `true`, `false`, `1`, `0`, `yes`, `no`, `y`, `n` (case-insensitive)
- Auto-fix: Normalizes to `true` or `false`
- Example: `yes` → `true`, `1` → `true`, `no` → `false`

**10. password-hash-complete** (error)
- If `password_hash` is provided, `password_hash_type` must also be provided
- Example: Row with `password_hash` but no `password_hash_type` → Error

### Duplicate Rules (2 rules)

**11. duplicate-email** (warning)
- Detects duplicate email addresses across rows
- Uses case-insensitive comparison
- First occurrence is tracked, subsequent ones flagged

**12. duplicate-external-id** (warning)
- Detects duplicate external_id values across rows
- First occurrence is tracked, subsequent ones flagged

---

## Mode Detection

The validator automatically detects the import mode based on CSV columns:

### Multi-Org Mode
**Detected when**: CSV has `org_id`, `org_external_id`, or `org_name` columns

```csv
email,first_name,org_external_id,org_name
alice@acme.com,Alice,acme-corp,Acme Corporation
bob@beta.com,Bob,beta-inc,Beta Inc
```

### User-Only Mode
**Detected when**: CSV has no organization columns

```csv
email,first_name,last_name
alice@example.com,Alice,Smith
bob@example.com,Bob,Jones
```

---

## Auto-Fix Capability

The validator can automatically fix common formatting issues:

### Auto-Fixable Issues

1. **Email Whitespace**
   - Removes leading/trailing spaces from emails
   - Example: ` alice@example.com ` → `alice@example.com`

2. **Boolean Formatting**
   - Normalizes boolean values to `true` or `false`
   - Example: `yes` → `true`, `1` → `true`, `no` → `false`

3. **Metadata Arrays/Objects** (WorkOS Limitation)
   - Converts arrays and nested objects to JSON strings
   - Example: `{"permissions":["read","write"]}` → `{"permissions":"[\"read\",\"write\"]"}`
   - **Critical**: Prevents import failures that show misleading "metadata_required" errors
   - WorkOS metadata only supports primitive values (strings, numbers, booleans)

### How to Use Auto-Fix

```bash
npx tsx bin/validate-csv.ts \
  --csv users.csv \
  --auto-fix \
  --fixed-csv users-fixed.csv
```

**What happens:**
1. Validator reads `users.csv`
2. Applies auto-fixes during streaming validation
3. Writes corrected data to `users-fixed.csv`
4. Reports number of issues fixed in summary

**Important:**
- Auto-fix only addresses formatting issues
- Structural errors (missing email, invalid JSON) cannot be auto-fixed
- Original file is never modified
- Review the fixed CSV before importing

---

## Validation Report

The validator generates a JSON report with detailed information about all issues found.

### Report Structure

```json
{
  "summary": {
    "totalRows": 1000,
    "validRows": 950,
    "invalidRows": 50,
    "warningRows": 20,
    "duplicateEmails": 5,
    "duplicateExternalIds": 3,
    "mode": "multi-org",
    "autoFixApplied": true,
    "fixedIssues": 20
  },
  "issues": [
    {
      "severity": "error",
      "category": "row",
      "recordNumber": 42,
      "field": "email",
      "message": "Missing required email",
      "ruleId": "required-email"
    },
    {
      "severity": "warning",
      "category": "duplicate",
      "recordNumber": 100,
      "field": "email",
      "email": "alice@example.com",
      "message": "Duplicate email: alice@example.com",
      "ruleId": "duplicate-email"
    }
  ],
  "timestamp": "2026-01-05T12:00:00.000Z",
  "csvHash": "abc123..."
}
```

### Summary Fields

| Field | Description |
|-------|-------------|
| `totalRows` | Total number of data rows processed |
| `validRows` | Rows with no errors |
| `invalidRows` | Rows with at least one error |
| `warningRows` | Rows with warnings (no errors) |
| `duplicateEmails` | Number of duplicate email addresses |
| `duplicateExternalIds` | Number of duplicate external_ids |
| `mode` | Detected mode (single-org/multi-org/user-only) |
| `autoFixApplied` | Whether auto-fix was enabled |
| `fixedIssues` | Number of issues auto-fixed |

### Issue Fields

| Field | Description |
|-------|-------------|
| `severity` | `error`, `warning`, or `info` |
| `category` | `header`, `row`, `duplicate`, or `api` |
| `recordNumber` | Row number in CSV (optional) |
| `field` | Field name where issue occurred (optional) |
| `email` | Email from the row (optional) |
| `message` | Human-readable description |
| `ruleId` | Identifier for the validation rule |
| `autoFixed` | Whether issue was auto-fixed (optional) |
| `originalValue` | Value before auto-fix (optional) |
| `fixedValue` | Value after auto-fix (optional) |

---

## Performance

The validator uses streaming architecture for constant memory usage regardless of CSV size.

### Performance Targets

| Dataset | Time | Memory | Throughput |
|---------|------|--------|------------|
| 10K rows | <5s | <100MB | 2000 rows/s |
| 100K rows | <30s | <200MB | 3300 rows/s |
| 1M rows | <5min | <500MB | 3300 rows/s |

**Memory Breakdown:**
- Row data: O(1) streaming (rows not held in memory)
- Duplicate tracking: ~100MB for 1M unique email+external_id values
- Report issues: ~50MB for 10K issues (typical: 100-1000 issues)

---

## Examples

### Example 1: Validate Before Import

```bash
# Step 1: Validate CSV
npx tsx bin/validate-csv.ts --csv users.csv

# Step 2: If valid (exit code 0), proceed with import
if [ $? -eq 0 ]; then
  npx tsx bin/import-users.ts --csv users.csv
else
  echo "Validation failed - fix errors before importing"
  exit 1
fi
```

### Example 2: Auto-Fix Workflow

```bash
# Step 1: Validate and auto-fix
npx tsx bin/validate-csv.ts \
  --csv users.csv \
  --auto-fix \
  --fixed-csv users-fixed.csv \
  --report validation-report.json

# Step 2: Review the report
cat validation-report.json

# Step 3: Import the fixed CSV
npx tsx bin/import-users.ts --csv users-fixed.csv
```

### Example 3: CI/CD Pipeline

```yaml
# GitHub Actions example
steps:
  - name: Validate CSV
    run: |
      npx tsx bin/validate-csv.ts \
        --csv data/users.csv \
        --report validation-report.json

  - name: Upload validation report
    uses: actions/upload-artifact@v3
    if: failure()
    with:
      name: validation-report
      path: validation-report.json

  - name: Import users
    if: success()
    run: |
      npx tsx bin/import-users.ts \
        --csv data/users.csv \
        --dry-run
```

### Example 4: Multi-Org Validation

```bash
# Validate multi-org CSV
npx tsx bin/validate-csv.ts \
  --csv multi-org-users.csv \
  --report multi-org-report.json

# Expected output:
# Mode detected: multi-org
# Validates org_id, org_external_id, org_name columns
```

---

## Troubleshooting

### Common Errors

#### Error: Missing required column: email

**Cause**: CSV file doesn't have an `email` column

**Solution**: Add `email` as the first column in your CSV:
```csv
email,first_name,last_name
alice@example.com,Alice,Smith
```

#### Error: Invalid email format

**Cause**: Email field doesn't contain `@`

**Solution**: Fix email addresses to include `@`:
```csv
# Bad
invalid-email

# Good
alice@example.com
```

#### Error: Invalid JSON in metadata field

**Cause**: Metadata column has malformed JSON

**Solution**: Ensure metadata is valid JSON:
```csv
# Bad
metadata
{invalid json}

# Good
metadata
"{""department"":""Engineering""}"
```

**Note**: In CSV, double quotes inside JSON must be escaped as `""`

#### Error: Row has both org_id and org_external_id

**Cause**: A row specifies both `org_id` and `org_external_id`

**Solution**: Use only one organization identifier per row:
```csv
# Bad
email,org_id,org_external_id
alice@example.com,org_001,acme-corp

# Good (use org_external_id)
email,org_external_id
alice@example.com,acme-corp

# OR (use org_id)
email,org_id
alice@example.com,org_001
```

#### Error: password_hash provided without password_hash_type

**Cause**: Row has `password_hash` but no `password_hash_type`

**Solution**: Always specify both:
```csv
# Bad
email,password_hash
alice@example.com,$2b$10$abc123...

# Good
email,password_hash,password_hash_type
alice@example.com,$2b$10$abc123...,bcrypt
```

### Warnings

#### Warning: Unknown column

**Cause**: CSV has columns not recognized by WorkOS

**Impact**: Unknown columns are ignored during import

**Solution**: Remove unknown columns or verify spelling:
```csv
# Unknown column: emial (typo)
emial,first_name

# Should be: email
email,first_name
```

#### Warning: Duplicate email

**Cause**: Same email appears multiple times

**Impact**:
- Single-org mode: Creates duplicate users (usually unintended)
- Multi-org mode: Creates one user with multiple memberships (intended behavior)

**Solution**:
- Single-org: Remove duplicates from CSV
- Multi-org: This is expected for users in multiple organizations

#### Warning: Invalid boolean value

**Cause**: `email_verified` has an invalid value

**Impact**: Value will be treated as `false` by WorkOS

**Solution**: Use valid boolean values or enable auto-fix:
```csv
# Valid boolean values
true, false, 1, 0, yes, no, y, n

# Auto-fix will normalize these:
yes → true
1 → true
no → false
0 → false
```

---

## Integration with Importer

The validator is designed to work seamlessly with the WorkOS importer:

### Recommended Workflow

1. **Validate** → Catch errors before import
2. **Auto-fix** → Fix common formatting issues
3. **Import** → Import validated/fixed CSV

```bash
# 1. Validate and auto-fix
npx tsx bin/validate-csv.ts \
  --csv users.csv \
  --auto-fix \
  --fixed-csv users-fixed.csv

# 2. Import the fixed CSV
npx tsx bin/import-users.ts \
  --csv users-fixed.csv \
  --concurrency 10
```

### What Validator Doesn't Check

The validator focuses on **pre-flight validation**. It does NOT check:

- ❌ Whether organizations exist in WorkOS (requires API calls)
- ❌ Whether users already exist in WorkOS (requires API calls)
- ❌ Password hash validity (requires WorkOS validation)
- ❌ Network connectivity
- ❌ API credentials validity

**Note**: API checking is planned for Phase 2.3 (future enhancement) via `--check-api` flag.

---

## API Reference

### Programmatic Usage

You can use the validator programmatically in your own scripts:

```typescript
import { CSVValidator } from './src/validator/csvValidator.js';
import type { ValidationOptions } from './src/validator/types.js';

const options: ValidationOptions = {
  csvPath: './users.csv',
  autoFix: true,
  fixedCsvPath: './users-fixed.csv',
  reportPath: './validation-report.json',
  quiet: false
};

const validator = new CSVValidator(options);
const report = await validator.validate();

console.log(`Valid rows: ${report.summary.validRows}`);
console.log(`Invalid rows: ${report.summary.invalidRows}`);
console.log(`Fixed issues: ${report.summary.fixedIssues}`);

// Check for errors
const errorCount = report.issues.filter(i => i.severity === 'error').length;
if (errorCount > 0) {
  console.error('Validation failed');
  process.exit(1);
}
```

### Types

All validator types are exported from `src/validator/types.ts`:

```typescript
import type {
  ValidationOptions,
  ValidationReport,
  ValidationSummary,
  ValidationIssue,
  ValidationRule,
  ValidationContext,
  AutoFixChange,
  ModeDetection
} from './src/validator/types.js';
```

---

## Testing

The validator includes comprehensive tests:

```bash
# Run validator tests
npx tsx src/validator/__test-validator.ts
```

**Test Coverage:**
- ✅ DuplicateDetector (11 tests)
- ✅ Validation rules (22 tests)
- ✅ Auto-fix functionality (12 tests)
- ✅ CSVValidator integration (15 tests)
- **Total: 60 tests**

---

## Next Steps

After validation, proceed with:

1. **Review Report**: Check `validation-report.json` for all issues
2. **Fix Errors**: Address any errors found (auto-fix handles formatting)
3. **Import**: Use the validated/fixed CSV with the importer
4. **Monitor**: Check import errors.jsonl for runtime issues

**Related Documentation:**
- [Import Users Guide](../README.md) - Main import documentation
- [Error Analysis](./PHASE4-ANALYZE.md) - Analyze import errors (future)
- [Auth0 Export](./PHASE1-EXPORT.md) - Export from Auth0 (optional)

---

## Support

For issues with the validator:
1. Check validation report for detailed error messages
2. Review troubleshooting section above
3. Run tests to verify validator is working: `npx tsx src/validator/__test-validator.ts`
4. Open an issue in the repository

**Common Questions:**
- **Q: Can I validate without fixing?** Yes, omit the `--auto-fix` flag
- **Q: Will validation modify my original CSV?** No, original is never modified
- **Q: Can I fix errors manually?** Yes, edit the CSV and re-validate
- **Q: What if I have many duplicates?** Warnings don't fail validation; review report to decide if intentional
