# WorkOS Metadata Requirements - Complete Guide

This document summarizes the critical learnings from testing Auth0 → WorkOS migrations.

## The Problem

During testing, we encountered persistent `metadata_required` validation errors from WorkOS, even though metadata was clearly present in the CSV. Through systematic testing, we discovered WorkOS has strict metadata validation rules that weren't initially documented.

## WorkOS Metadata Rules

### 1. All Metadata Values Must Be Strings ⚠️

**Rule**: WorkOS requires ALL metadata values to be strings. No exceptions.

**Forbidden Types**:
- ❌ Booleans: `"active": true`
- ❌ Numbers: `"count": 42`
- ❌ Arrays: `"roles": ["admin", "user"]`
- ❌ Objects: `"settings": {"theme": "dark"}`

**Correct Format**:
- ✅ String booleans: `"active": "true"`
- ✅ String numbers: `"count": "42"`
- ✅ JSON string arrays: `"roles": "[\"admin\",\"user\"]"`
- ✅ JSON string objects: `"settings": "{\"theme\":\"dark\"}"`

### 2. Reserved Field Names

**Rule**: Certain field names conflict with WorkOS's internal organization handling.

**Reserved Names**:
- `organization_id`
- `organization_name`
- `org_id`
- `org_name`
- `organizationId`
- `organizationName`

**Solution**: Rename with a prefix (e.g., `auth0_organization_id`)

### 3. CSV Column Order Matters

**Rule**: WorkOS expects columns in a specific order.

**Required Order**:
```
email,first_name,last_name,email_verified,external_id,org_external_id,org_name,metadata
```

**Note**: The `metadata` column must be last, after all organization columns.

## Testing Results

### ✅ What Works

```csv
email,first_name,last_name,email_verified,external_id,org_external_id,org_name,metadata
alice@acme.com,Alice,Smith,true,user_001,org_123,Acme Corp,"{""department"":""Engineering"",""active"":""true"",""count"":""42""}"
```

### ❌ What Fails

```csv
email,first_name,last_name,email_verified,external_id,org_external_id,org_name,metadata
alice@acme.com,Alice,Smith,true,user_001,org_123,Acme Corp,"{""department"":""Engineering"",""active"":true,""count"":42}"
```

**Error**: `metadata_required` (422 status code)

## Implementation in Auth0 Exporter

The Auth0 exporter includes automatic sanitization via `sanitizeMetadataForWorkOS()`:

```typescript
function sanitizeMetadataForWorkOS(metadata: Record<string, unknown>): Record<string, string> {
  const sanitized: Record<string, string> = {};

  for (const [key, value] of Object.entries(metadata)) {
    // Rename reserved fields
    if (key === 'organization_id' || key === 'organization_name' ||
        key === 'org_id' || key === 'org_name') {
      sanitized[`auth0_${key}`] = convertToString(value);
      continue;
    }

    // Convert all values to strings
    sanitized[key] = convertToString(value);
  }

  return sanitized;
}

function convertToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  // Arrays and objects
  return JSON.stringify(value);
}
```

## Common Errors

### Error: `metadata_required`

**Symptoms**:
```
status=422 code=invalid_request_parameters
message=The following requirement must be met: metadata_required
```

**Diagnosis Checklist**:
1. ✓ Check if metadata column exists
2. ✓ Check if metadata contains non-string values
3. ✓ Check for reserved field names
4. ✓ Verify column order is correct

### Error: `external_id already assigned`

**Symptoms**:
```
status=400
message=The external_id provided has already been assigned to another organization.
```

**Solution**: Make external_ids unique for testing
```bash
node make-unique.cjs input.csv output.csv
```

## Best Practices

### For Auth0 Migrations

1. **Use the Auth0 exporter** - It handles sanitization automatically
2. **Test with small datasets first** - Validate 10-20 users before full export
3. **Keep original values** - Sanitization preserves data (arrays → JSON strings)
4. **Document custom fields** - Note which fields were renamed (org_id → auth0_org_id)

### For Custom Exporters

If building your own exporter:

1. **Convert all metadata values to strings** before writing to CSV
2. **Avoid reserved field names** or rename them
3. **Maintain column order**: email, names, verified, external_id, org fields, metadata
4. **Test imports incrementally** to catch issues early

## Recovery from Failed Imports

If you already have a CSV with problematic metadata:

### Option 1: Re-export with updated exporter
```bash
npx tsx bin/export-auth0.ts \
  --domain your-tenant.auth0.com \
  --client-id YOUR_ID \
  --client-secret YOUR_SECRET \
  --output fixed-export.csv
```

### Option 2: Manual sanitization script
```javascript
const fs = require('fs');
const csv = require('csv-parse/sync');
const stringify = require('csv-stringify/sync');

const input = fs.readFileSync('input.csv', 'utf8');
const records = csv.parse(input, { columns: true });

const sanitized = records.map(row => {
  if (row.metadata) {
    const metadata = JSON.parse(row.metadata);
    const fixed = {};

    for (const [key, value] of Object.entries(metadata)) {
      fixed[key] = typeof value === 'string' ? value : JSON.stringify(value);
    }

    row.metadata = JSON.stringify(fixed);
  }
  return row;
});

const output = stringify(sanitized, { header: true });
fs.writeFileSync('output.csv', output);
```

## Summary

**Critical Requirements**:
- ✅ All metadata values must be strings
- ✅ Avoid reserved field names (organization_id, etc.)
- ✅ Maintain correct column order
- ✅ Test with small datasets first

**Error Message Translation**:
- `metadata_required` = metadata validation failed (check types, not just presence)
- `external_id already assigned` = duplicate IDs from previous imports

**Tools**:
- `bin/export-auth0.ts` - Handles sanitization automatically
- `make-unique.cjs` - Adds unique suffixes for testing
- `bin/import-users.ts` - WorkOS import with error logging
