# Phase 3: CSV Field Mapper

Transform CSV files from identity provider formats (Auth0, Okta, Cognito) to WorkOS import format.

## Overview

The CSV Field Mapper automates the tedious process of reformatting CSV files between identity providers. Instead of manually renaming columns, merging fields, and fixing data formats in Excel, use one command to transform thousands of rows with constant memory usage.

**Key Features:**
- ✅ Built-in Auth0 profile (Okta/Cognito coming soon)
- ✅ Custom JSON profiles for any provider
- ✅ 8 transformation functions (lowercase, boolean conversion, metadata merging, etc.)
- ✅ Streaming architecture (constant memory for any CSV size)
- ✅ Metadata field merging (many-to-one)
- ✅ Optional validation integration (Phase 2 validator)
- ✅ Detailed unmapped field reporting
- ✅ Error handling (log and continue)

---

## Quick Start

### Basic Transformation

Transform an Auth0 CSV export to WorkOS format:

```bash
npx tsx bin/map-fields.ts \
  --input auth0-export.csv \
  --output workos-ready.csv \
  --profile auth0
```

### With Validation

Transform and validate the output in one command:

```bash
npx tsx bin/map-fields.ts \
  --input auth0-export.csv \
  --output workos-ready.csv \
  --profile auth0 \
  --validate
```

### List Available Profiles

See what built-in profiles are available:

```bash
npx tsx bin/map-fields.ts --list-profiles
```

---

## CLI Options

| Option | Description | Required |
|--------|-------------|----------|
| `--input <path>` | Input CSV file path | ✅ Yes |
| `--output <path>` | Output CSV file path | ✅ Yes |
| `--profile <name\|path>` | Profile name (`auth0`) or path to custom JSON profile | ✅ Yes |
| `--validate` | Validate output CSV after mapping (using Phase 2 validator) | No |
| `--quiet` | Suppress progress output | No |
| `--list-profiles` | List available built-in profiles and exit | No |

---

## Exit Codes

The mapper uses standard exit codes for CI/CD integration:

| Exit Code | Meaning | Description |
|-----------|---------|-------------|
| `0` | Success | All rows transformed successfully |
| `1` | Partial | Completed with some row errors |
| `2` | Fatal | Bad options, file not found, or execution error |

**Example CI/CD usage:**
```bash
# Transform, validate, and import
npx tsx bin/map-fields.ts \
  --input auth0-export.csv \
  --output workos-ready.csv \
  --profile auth0 \
  --validate || exit 1

npx tsx bin/import-users.ts --csv workos-ready.csv
```

---

## Built-in Profiles

### Auth0 Profile

Transforms Auth0 user exports to WorkOS format.

**Source Format (Auth0):**
```csv
user_id,email,given_name,family_name,email_verified,user_metadata,app_metadata,org_id,org_name
auth0|123,alice@acme.com,Alice,Smith,true,"{""dept"":""Eng""}","{""role"":""admin""}",org_001,Acme Corp
```

**Target Format (WorkOS):**
```csv
email,first_name,last_name,email_verified,external_id,metadata,org_external_id,org_name
alice@acme.com,Alice,Smith,true,auth0|123,"{""_provider"":""auth0"",""auth0_dept"":""Eng"",""auth0_role"":""admin""}",org_001,Acme Corp
```

**Field Mappings:**
- `email` → `email` (lowercase + trim)
- `given_name` → `first_name`
- `family_name` → `last_name`
- `email_verified` → `email_verified` (boolean conversion)
- `user_id` → `external_id`
- `user_metadata` + `app_metadata` → `metadata` (merged with `auth0_` prefix)
- `org_id` → `org_external_id`
- `org_name` → `org_name`

**Usage:**
```bash
npx tsx bin/map-fields.ts \
  --input auth0-export.csv \
  --output workos-ready.csv \
  --profile auth0
```

### Future Profiles

**Okta** and **Cognito** profiles can be easily added following the same pattern. See "Adding New Profiles" section below.

---

## Custom Profiles

Create custom mapping profiles using JSON for any identity provider.

### Profile Structure

```json
{
  "name": "custom",
  "description": "Custom provider to WorkOS format",
  "mappings": [
    {
      "sourceField": "email",
      "targetField": "email",
      "transformer": "lowercase_trim"
    },
    {
      "sourceField": "firstName",
      "targetField": "first_name",
      "transformer": "trim"
    }
  ],
  "metadataMapping": {
    "targetField": "metadata",
    "sourceFields": ["customMetadata"],
    "fieldPrefix": "custom_",
    "staticMetadata": {
      "_provider": "custom"
    }
  }
}
```

### Field Mapping Options

**Required:**
- `sourceField` - Column name in source CSV
- `targetField` - Column name in target CSV

**Optional:**
- `transformer` - Transformation function name (see Transformers section)
- `defaultValue` - Value to use if source is blank
- `skipIfBlank` - Skip this mapping if source value is blank

**Example - Complex Mapping:**
```json
{
  "sourceField": "user_status",
  "targetField": "email_verified",
  "transformer": "to_boolean",
  "defaultValue": "false",
  "skipIfBlank": false
}
```

### Using Custom Profiles

```bash
npx tsx bin/map-fields.ts \
  --input provider-export.csv \
  --output workos-ready.csv \
  --profile ./my-custom-profile.json
```

---

## Transformers

Transformers are functions that convert values from source to target format.

### Available Transformers

**1. lowercase_trim**
- Converts to lowercase and trims whitespace
- Example: `"  ALICE@EXAMPLE.COM  "` → `"alice@example.com"`
- Use for: Email addresses

**2. trim**
- Removes leading/trailing whitespace
- Example: `"  Alice  "` → `"Alice"`
- Use for: Names, text fields

**3. uppercase**
- Converts to uppercase
- Example: `"hello"` → `"HELLO"`
- Use for: Codes, identifiers

**4. to_boolean**
- Converts various formats to `"true"` or `"false"` strings
- Handles: `true`, `false`, `yes`, `no`, `y`, `n`, `1`, `0` (case-insensitive)
- Example: `"yes"` → `"true"`, `"0"` → `"false"`
- Use for: `email_verified` field

**5. to_json_string**
- Converts objects to JSON strings
- Already-JSON strings are validated
- Example: `{dept: "Eng"}` → `'{"dept":"Eng"}'`
- Use for: Metadata fields

**6. identity**
- Passes value through unchanged
- Example: `"hello"` → `"hello"`
- Use for: No transformation needed

**7. split_name** (special)
- Splits full name into first/last
- Example: `"Alice Smith"` → firstName: `"Alice"`, lastName: `"Smith"`
- Use for: Name parsing (custom handling required)

**8. merge_metadata** (special)
- Used internally by `metadataMapping`
- Merges multiple source fields into one JSON object
- See "Metadata Mapping" section

### Using Transformers

Specify transformer name in field mapping:

```json
{
  "sourceField": "email",
  "targetField": "email",
  "transformer": "lowercase_trim"
}
```

---

## Metadata Mapping

Merge multiple source fields into a single WorkOS `metadata` JSON field.

### Why Metadata Mapping?

**Problem:** Auth0 has separate `user_metadata` and `app_metadata` fields, but WorkOS has one `metadata` field.

**Solution:** Metadata mapping merges multiple source fields into one:

```json
"metadataMapping": {
  "targetField": "metadata",
  "sourceFields": ["user_metadata", "app_metadata"],
  "fieldPrefix": "auth0_",
  "staticMetadata": {
    "_provider": "auth0"
  }
}
```

### How It Works

**Input:**
- `user_metadata`: `{"department":"Engineering"}`
- `app_metadata`: `{"role":"admin"}`

**Output:**
```json
{
  "_provider": "auth0",
  "auth0_department": "Engineering",
  "auth0_role": "admin"
}
```

### Metadata Mapping Options

- `targetField` - Always `"metadata"` for WorkOS
- `sourceFields` - Array of source field names to merge
- `fieldPrefix` - Optional prefix for all keys (e.g., `"auth0_"`)
- `staticMetadata` - Optional static fields to include

---

## Integration with Phase 2 Validator

The field mapper can automatically validate the output CSV using the Phase 2 validator.

### Usage

```bash
npx tsx bin/map-fields.ts \
  --input auth0-export.csv \
  --output workos-ready.csv \
  --profile auth0 \
  --validate
```

### What Happens

1. Transform CSV from Auth0 → WorkOS format
2. Run Phase 2 validator on output
3. Generate validation report: `workos-ready-validation-report.json`
4. Display validation summary

### Benefits

- Catch errors before importing to WorkOS
- Verify transformed data is valid
- Auto-fix common issues (whitespace, booleans)
- One-command transformation + validation

---

## Unmapped Field Tracking

The mapper tracks source fields that weren't mapped to the output.

### Example Output

```
Unmapped source fields (3):
  - created_at (1000 rows)
  - updated_at (1000 rows)
  - internal_id (1000 rows)

These fields were not included in the output CSV.
To map them, update your profile or use a custom profile.
```

### Why This Matters

- **Data Loss Prevention**: See what fields you're not migrating
- **Profile Improvement**: Identify fields to add to your profile
- **Intentional Omission**: Confirm you're deliberately skipping certain fields

### How to Map Unmapped Fields

**Option 1**: Add to profile's field mappings:
```json
{
  "sourceField": "created_at",
  "targetField": "metadata"  // Store in metadata
}
```

**Option 2**: Add to metadata mapping:
```json
"metadataMapping": {
  "sourceFields": ["user_metadata", "app_metadata", "created_at", "updated_at"]
}
```

---

## Performance

The mapper uses streaming architecture for constant memory usage.

### Performance Targets

| Dataset | Time | Memory | Throughput |
|---------|------|--------|------------|
| 10K rows | <5s | <100MB | 2000 rows/s |
| 100K rows | <30s | <200MB | 3300 rows/s |
| 1M rows | <5min | <500MB | 3300 rows/s |

**Memory Profile:**
- Row data: O(1) streaming (rows not held in memory)
- Profile config: ~10KB
- Unmapped tracking: ~100KB for 10K unique fields

### Progress Logging

Progress is logged every 10,000 rows:

```
Starting CSV field mapping...
Processed 10000 rows...
Processed 20000 rows...
Mapping complete: 50000/50000 rows
```

Suppress with `--quiet`:
```bash
npx tsx bin/map-fields.ts --input in.csv --output out.csv --profile auth0 --quiet
```

---

## Error Handling

The mapper handles errors gracefully and continues processing.

### Row-Level Errors

Errors are logged but don't stop the transformation:

```
⚠️  Errors occurred during mapping (5):
  Row 42: Transformer 'to_boolean' failed for field 'email_verified': Invalid value
  Row 103: Transformer 'to_json_string' failed for field 'metadata': Circular reference
  ... and 3 more errors
```

### Error Threshold

Transformation stops if more than 1,000 errors occur (prevents runaway failures).

### Reviewing Errors

Check the summary for error details. Fix source CSV and retry.

---

## Complete Workflow Example

### End-to-End Migration: Auth0 → WorkOS

```bash
# Step 1: Export from Auth0 (Phase 1 - future)
# Manually export or use Auth0 CLI for now

# Step 2: Transform to WorkOS format (Phase 3 - THIS PHASE)
npx tsx bin/map-fields.ts \
  --input auth0-export.csv \
  --output workos-ready.csv \
  --profile auth0 \
  --validate

# Step 3: Import to WorkOS (Phase 1 - complete)
npx tsx bin/import-users.ts \
  --csv workos-ready.csv \
  --concurrency 10
```

### Time Savings

**Without Field Mapper:**
- Manually rename columns in Excel: 10-30 minutes
- Fix data formats (booleans, JSON): 20-60 minutes
- Merge metadata fields: 10-20 minutes
- Fix errors discovered during import: 30-120 minutes
- **Total: 70-230 minutes**

**With Field Mapper:**
- Run one command: <1 minute for 100K rows
- **Total: <1 minute**

---

## Adding New Profiles

The profile registry is designed for easy extensibility. Adding Okta or Cognito takes <1 hour.

### Step 1: Create Profile File

Create `src/mapper/profiles/oktaProfile.ts`:

```typescript
import type { MappingProfile } from '../types.js';

const oktaProfile: MappingProfile = {
  name: 'okta',
  description: 'Okta user export to WorkOS format',
  mappings: [
    {
      sourceField: 'login',
      targetField: 'email',
      transformer: 'lowercase_trim'
    },
    {
      sourceField: 'firstName',
      targetField: 'first_name',
      transformer: 'trim'
    },
    // ... more mappings
  ],
  metadataMapping: {
    targetField: 'metadata',
    sourceFields: ['profile'],
    fieldPrefix: 'okta_'
  }
};

export default oktaProfile;
```

### Step 2: Register Profile

Add to `src/mapper/profiles/index.ts`:

```typescript
const BUILT_IN_PROFILES: Record<string, () => Promise<{ default: MappingProfile }>> = {
  'auth0': () => import('./auth0Profile.js'),
  'okta': () => import('./oktaProfile.js'),  // ADD THIS LINE
};
```

### Step 3: Test

```bash
npx tsx bin/map-fields.ts --list-profiles
# Should now show 'okta'

npx tsx bin/map-fields.ts \
  --input okta-export.csv \
  --output workos-ready.csv \
  --profile okta
```

That's it! The new profile is now available.

---

## Troubleshooting

### Common Issues

#### Issue: "Profile not found: myprofile"

**Cause:** Profile name doesn't exist or path is incorrect.

**Solution:**
```bash
# List available profiles
npx tsx bin/map-fields.ts --list-profiles

# Use correct name
npx tsx bin/map-fields.ts --profile auth0 ...

# Or use absolute path for custom profile
npx tsx bin/map-fields.ts --profile /full/path/to/custom.json ...
```

#### Issue: "Unknown transformer: my_transformer"

**Cause:** Transformer doesn't exist.

**Solution:** Use one of the available transformers:
- `lowercase_trim`, `trim`, `uppercase`, `to_boolean`, `to_json_string`, `identity`

#### Issue: Metadata not merging correctly

**Cause:** Source fields might not be valid JSON.

**Solution:** Check your source CSV:
```csv
# Bad (not JSON)
user_metadata
just some text

# Good (valid JSON)
user_metadata
"{""department"":""Engineering""}"
```

#### Issue: Output CSV has empty columns

**Cause:** Source fields don't exist or are all blank.

**Solution:** Check "Unmapped source fields" in the summary output. Your source CSV might use different column names.

#### Issue: Boolean values not converting

**Cause:** Source values might not be recognized.

**Solution:** The `to_boolean` transformer handles:
- `true`, `false` (case-insensitive)
- `yes`, `no`, `y`, `n`
- `1`, `0`

Other values will pass through unchanged.

---

## API Reference

### Programmatic Usage

Use the mapper in your own scripts:

```typescript
import { FieldMapper } from './src/mapper/fieldMapper.js';
import { loadProfile } from './src/mapper/profiles/index.js';

const profile = await loadProfile('auth0');

const mapper = new FieldMapper({
  inputPath: './input.csv',
  outputPath: './output.csv',
  profile,
  quiet: false,
  validateAfter: true
});

const summary = await mapper.transform();

console.log(`Transformed ${summary.successfulRows}/${summary.totalRows} rows`);
console.log(`Duration: ${summary.durationMs}ms`);
```

### Types

All types are exported from `src/mapper/types.ts`:

```typescript
import type {
  MappingProfile,
  FieldMapping,
  MetadataMapping,
  TransformerFunction,
  MapperOptions,
  MappingSummary,
  MappingError
} from './src/mapper/types.js';
```

---

## Testing

Run mapper tests:

```bash
npx tsx src/mapper/__test-mapper.ts
```

**Test Coverage:**
- ✅ Transformer registry (8 tests)
- ✅ Transformer functions (11 tests)
- ✅ Profile registry (5 tests)
- ✅ Integration (3 tests)
- **Total: 27 tests**

---

## Next Steps

After mapping:

1. **Review Output**: Check the summary for unmapped fields and errors
2. **Validate**: Run Phase 2 validator if you didn't use `--validate`
3. **Import**: Use Phase 1 importer to import to WorkOS
4. **Monitor**: Check `errors.jsonl` for any import failures

**Related Documentation:**
- [Phase 1: Import Users](../README.md) - Import to WorkOS
- [Phase 2: CSV Validator](./PHASE2-VALIDATE.md) - Pre-flight validation
- [Phase 4: Error Analyzer](./PHASE4-ANALYZE.md) - Analyze import errors (future)

---

## Support

For issues with the field mapper:
1. Check unmapped fields in the summary output
2. Review troubleshooting section above
3. Verify your source CSV format matches expectations
4. Run tests: `npx tsx src/mapper/__test-mapper.ts`
5. Open an issue in the repository

**Common Questions:**
- **Q: Can I transform without validation?** Yes, omit the `--validate` flag
- **Q: Will mapping modify my original CSV?** No, original is never modified
- **Q: Can I use multiple profiles?** No, but you can create a custom profile that combines logic
- **Q: How do I map a field to metadata?** Use `metadataMapping` in your profile
