# Multi-Organization Import Guide

Import users across multiple organizations in a single CSV file.

## Overview

Multi-org mode allows you to import users for different organizations using a single CSV file. Each row can specify its own organization via `org_id`, `org_external_id`, or `org_name` columns.

## When to Use Multi-Org Mode

✅ Migrating from multi-tenant systems (Auth0, Okta, etc.)
✅ Importing users for multiple customer organizations
✅ Testing with diverse organization structures
✅ Bulk onboarding across different companies

## CSV Format

Add organization columns to enable multi-org mode:

```csv
email,first_name,last_name,org_external_id,org_name
alice@acme.com,Alice,Smith,acme-corp,Acme Corporation
bob@acme.com,Bob,Jones,acme-corp,Acme Corporation
charlie@beta.com,Charlie,Brown,beta-inc,Beta Inc
```

### Organization Column Options

Choose ONE of:

- **`org_id`** - Direct WorkOS organization ID (fastest, no lookup)
- **`org_external_id`** - Your external org ID (cached API lookup)
- **`org_name`** - Organization name (used when creating orgs)

**Important:** Cannot use both `org_id` and `org_external_id` in same row.

## How It Works

### Automatic Mode Detection

```
┌─────────────────────────────────────────────────┐
│ CLI Flags Present?                              │
│ (--org-id or --org-external-id)                 │
├─────────────────────────────────────────────────┤
│ YES → Single-Org Mode                           │
│  ↳ All users added to same organization         │
│                                                  │
│ NO → Check CSV Headers                          │
│  ↳ Has org_id or org_external_id columns?       │
│     • YES → Multi-Org Mode                      │
│     • NO  → User-Only Mode (no memberships)     │
└─────────────────────────────────────────────────┘
```

### Organization Resolution Priority

For each row:

1. **`org_id` provided** → Use directly (cached)
2. **`org_external_id` provided** → API lookup (cached)
3. **Organization not found + `org_name`** → Create new org
4. **Organization not found + no `org_name`** → Error

## Examples

### Basic Multi-Org Import

```bash
WORKOS_SECRET_KEY=sk_test_123 \
  npx tsx bin/import-users.ts --csv multi-org-users.csv
```

CSV automatically detected as multi-org mode.

### With Existing Organizations

CSV:
```csv
email,first_name,org_external_id
alice@acme.com,Alice,acme-corp
bob@beta.com,Bob,beta-inc
charlie@acme.com,Charlie,acme-corp
```

Behavior:
- Looks up `acme-corp` and `beta-inc` via API
- Caches both after first lookup
- Third row uses cached `acme-corp` (no API call)

### With Organization Creation

CSV:
```csv
email,first_name,org_external_id,org_name
alice@newco.com,Alice,newco-2024,NewCo Inc
bob@newco.com,Bob,newco-2024,NewCo Inc
```

Behavior:
- First row: Creates `NewCo Inc` with `external_id=newco-2024`
- Second row: Uses cached organization

## Multi-Membership Support

A single user can belong to multiple organizations by appearing in multiple rows.

### Example

CSV:
```csv
email,first_name,last_name,external_id,org_external_id,org_name
alice@example.com,Alice,Smith,user-001,acme-corp,Acme Corp
alice@example.com,Alice,Smith,user-001,beta-inc,Beta Inc
alice@example.com,Alice,Smith,user-001,gamma-llc,Gamma LLC
```

Result:
- **1 user created**
- **3 memberships created** (Acme, Beta, Gamma)
- User data from first row wins

### Important Notes

1. **User data from first row wins** - Subsequent rows ignored for user fields
2. **Same email = same user** - Case-insensitive matching
3. **External ID should match** - Use same `external_id` across rows
4. **Duplicate memberships skipped** - Same user+org combination skipped gracefully

### Summary Output

```
┌────────────────────────────────┐
│ SUMMARY                        │
│ Status: Success                │
│ Total rows processed: 5        │
│ Users created: 2               │
│ Duplicate users: 3             │
│ Memberships created: 5         │
│ Duplicate memberships: 0       │
│ Cache hits: 3                  │
│ Cache misses: 2                │
└────────────────────────────────┘
```

- **Users created**: New users in WorkOS
- **Duplicate users**: Rows where user existed (memberships added)
- **Memberships created**: Total memberships across all orgs
- **Duplicate memberships**: Memberships that already existed

## Cache Performance

Multi-org mode uses intelligent caching:

### Cache Effectiveness

| Scenario | Orgs | Users | Cache Hits | API Calls | Hit Rate |
|----------|------|-------|------------|-----------|----------|
| 100 users, 5 orgs | 5 | 100 | 95 | 5 | 95% |
| 1K users, 50 orgs | 50 | 1,000 | 950 | 50 | 95% |
| 10K users, 100 orgs | 100 | 10,000 | 9,900 | 100 | 99% |
| 100K users, 1K orgs | 1,000 | 100,000 | 99,000 | 1,000 | 99% |

### Cache Configuration

Default settings (optimal for most cases):
- **Capacity:** 10,000 organizations
- **Eviction:** LRU (Least Recently Used)
- **Coalescing:** Prevents duplicate API calls

## Large Scale Imports

For 100K+ users across many organizations, use worker pool with pre-warming:

```bash
WORKOS_SECRET_KEY=sk_test_123 \
  npx tsx bin/import-users.ts \
    --csv large-multi-org.csv \
    --job-id prod-migration \
    --workers 4 \
    --chunk-size 1000
```

**Pre-warming** eliminates race conditions by creating all organizations before workers start.

See [Worker Pool Guide](../advanced/WORKER-POOL.md) and [Pre-Warming](../advanced/PRE-WARMING.md).

## Error Handling

### org_resolution Errors

When organization resolution fails:

```json
{
  "recordNumber": 5,
  "email": "user@example.com",
  "errorType": "org_resolution",
  "errorMessage": "Organization not found: acme-corp",
  "orgExternalId": "acme-corp",
  "httpStatus": 404
}
```

### Common Errors

**Organization not found (404)**
- Org doesn't exist
- Add `org_name` column to create
- Or pre-create organizations in WorkOS

**External ID already assigned**
- Organization with that `external_id` already exists
- Check for duplicates in WorkOS

**Both org_id and org_external_id specified**
- Cannot use both in same row
- Choose one column

## Migration from Single-Org

### Step 1: Add org columns to CSV

Before (single-org):
```csv
email,first_name,last_name
alice@acme.com,Alice,Smith
```

After (multi-org):
```csv
email,first_name,last_name,org_external_id
alice@acme.com,Alice,Smith,acme-corp
```

### Step 2: Remove CLI org flags

Before:
```bash
npx tsx bin/import-users.ts --csv users.csv --org-id org_123
```

After:
```bash
npx tsx bin/import-users.ts --csv users.csv
```

### Step 3: Verify with dry-run

```bash
npx tsx bin/import-users.ts --csv users.csv --dry-run
```

Look for: `Multi-org mode: Organizations will be resolved per-row from CSV`

## Mode Conflict Handling

If both CLI flags AND CSV org columns present:

```bash
npx tsx bin/import-users.ts \
  --csv multi-org.csv \
  --org-id org_123
```

Result:
- ⚠️ Warning displayed
- **CLI flags win** (single-org mode)
- CSV org columns ignored
- All users added to `org_123`

This prevents accidental multi-org mode in existing scripts.

## Use Cases

### Consultants Across Multiple Clients

```csv
email,first_name,external_id,org_external_id,org_name
consultant@example.com,Alice,user-001,client-a,Client A Inc
consultant@example.com,Alice,user-001,client-b,Client B Corp
consultant@example.com,Alice,user-001,client-c,Client C LLC
```

Result: 1 user with access to 3 client organizations

### Platform Administrators

```csv
email,first_name,role,org_external_id,org_name
admin@platform.com,Admin,platform-admin,tenant-1,Tenant One
admin@platform.com,Admin,platform-admin,tenant-2,Tenant Two
admin@platform.com,Admin,platform-admin,tenant-3,Tenant Three
```

Result: Platform admin with access to multiple tenants

### Parent and Subsidiary Companies

```csv
email,first_name,org_external_id,org_name
user@corp.com,Alice,parent-corp,Parent Corp
user@corp.com,Alice,subsidiary-a,Subsidiary A
user@corp.com,Alice,subsidiary-b,Subsidiary B
```

Result: User with access to parent and subsidiaries

## Related Documentation

- [CSV Format Reference](CSV-FORMAT.md) - Complete CSV column reference
- [Import Phase](../phases/05-IMPORT.md) - All import options
- [Worker Pool](../advanced/WORKER-POOL.md) - Parallel processing
- [Pre-Warming](../advanced/PRE-WARMING.md) - Eliminate race conditions
