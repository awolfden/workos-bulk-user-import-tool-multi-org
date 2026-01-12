# Phase 1: Auth0 Exporter

Export users and organizations from Auth0 to WorkOS-compatible CSV format.

## Overview

The Auth0 exporter provides a streamlined way to export your entire Auth0 tenant (users and organizations) to a CSV file that can be directly imported into WorkOS.

**Key Features:**
- ✅ Streaming architecture (handles 100K+ users without memory issues)
- ✅ Organization-based export (preserves org membership)
- ✅ Metadata preservation (user_metadata + app_metadata merged)
- ✅ Progress tracking
- ✅ Automatic pagination
- ✅ Graceful error handling

## Prerequisites

### 1. Auth0 Management API Credentials

You need a Machine-to-Machine (M2M) application in Auth0 with Management API access.

**Setup Steps:**
1. Go to your Auth0 Dashboard → Applications → Create Application
2. Choose "Machine to Machine Applications"
3. Authorize it for the "Auth0 Management API"
4. Grant the following scopes:
   - `read:users`
   - `read:organizations`
   - `read:organization_members`

**Required Information:**
- Domain: Your Auth0 tenant domain (e.g., `mycompany.auth0.com`)
- Client ID: From the M2M application settings
- Client Secret: From the M2M application settings

### 2. Install Dependencies

```bash
npm install
```

This installs the `auth0` SDK and other required dependencies.

## Usage

### Basic Export

Export all organizations and users:

```bash
npx tsx bin/export-auth0.ts \
  --domain mycompany.auth0.com \
  --client-id YOUR_CLIENT_ID \
  --client-secret YOUR_CLIENT_SECRET \
  --output auth0-export.csv
```

### Export Specific Organizations

Filter to specific organization IDs:

```bash
npx tsx bin/export-auth0.ts \
  --domain mycompany.auth0.com \
  --client-id YOUR_CLIENT_ID \
  --client-secret YOUR_CLIENT_SECRET \
  --output filtered-export.csv \
  --orgs org_abc123 org_def456 org_ghi789
```

### Quiet Mode

Suppress progress output:

```bash
npx tsx bin/export-auth0.ts \
  --domain mycompany.auth0.com \
  --client-id YOUR_CLIENT_ID \
  --client-secret YOUR_CLIENT_SECRET \
  --output auth0-export.csv \
  --quiet
```

### Custom Page Size

Adjust API pagination (default: 100, max: 100):

```bash
npx tsx bin/export-auth0.ts \
  --domain mycompany.auth0.com \
  --client-id YOUR_CLIENT_ID \
  --client-secret YOUR_CLIENT_SECRET \
  --output auth0-export.csv \
  --page-size 50
```

### Rate Limiting

Control API request rate to match your Auth0 plan tier (default: 50 rps):

```bash
# For Auth0 Free tier (2 rps)
npx tsx bin/export-auth0.ts \
  --domain mycompany.auth0.com \
  --client-id YOUR_CLIENT_ID \
  --client-secret YOUR_CLIENT_SECRET \
  --output auth0-export.csv \
  --rate-limit 2

# For Auth0 Enterprise (100+ rps)
npx tsx bin/export-auth0.ts \
  --domain mycompany.auth0.com \
  --client-id YOUR_CLIENT_ID \
  --client-secret YOUR_CLIENT_SECRET \
  --output auth0-export.csv \
  --rate-limit 100
```

**Auth0 Rate Limits by Plan**:
- **Free**: 2 requests/second
- **Developer**: 50 requests/second (default)
- **Enterprise**: 100+ requests/second

**Benefits**:
- ✅ **Prevents 429 errors**: Automatic rate limiting prevents hitting Auth0 API limits
- ✅ **Automatic retries**: If rate limited, exports automatically retry with exponential backoff
- ✅ **Respects Retry-After**: Honors Auth0's Retry-After header for optimal timing
- ✅ **No manual intervention**: Set it once and export safely, even for large datasets

## Output Format

The exporter generates a CSV file in WorkOS format with the following columns:

| Column | Description | Example |
|--------|-------------|---------|
| `email` | User email (required) | alice@acme.com |
| `first_name` | Given name | Alice |
| `last_name` | Family name | Smith |
| `email_verified` | Email verification status | true |
| `external_id` | Auth0 user ID | auth0\|123456 |
| `org_external_id` | Auth0 org ID | org_abc123 |
| `org_name` | Organization name | Acme Corporation |
| `metadata` | User + app metadata (JSON) | {"department":"Engineering"} |

**Note**: Column order matters for WorkOS import. The exporter outputs columns in the exact order required by WorkOS.

### Field Mapping

**Auth0 → WorkOS Mapping:**
- `user.email` → `email`
- `user.given_name` → `first_name`
- `user.family_name` → `last_name`
- `user.email_verified` → `email_verified`
- `user.user_id` → `external_id`
- `merge(user_metadata, app_metadata)` → `metadata` (JSON)
- `org.id` → `org_external_id`
- `org.display_name || org.name` → `org_name`

**Metadata Enrichment:**

The exporter automatically includes Auth0-specific fields in metadata for reference:
```json
{
  "auth0_user_id": "auth0|123456",
  "auth0_created_at": "2024-01-15T10:30:00.000Z",
  "auth0_updated_at": "2024-12-01T14:22:33.000Z",
  "auth0_last_login": "2024-12-03T12:05:30.000Z",
  "auth0_logins_count": "47",
  "auth0_identities": "[{\"provider\":\"auth0\",\"connection\":\"Username-Password-Authentication\",\"isSocial\":false}]",
  "department": "Engineering",
  "roles": "[\"admin\",\"developer\"]"
}
```

### WorkOS Metadata Requirements ⚠️

**Critical**: WorkOS has strict metadata validation rules. The exporter automatically sanitizes metadata to ensure compatibility:

1. **All values must be strings**
   - ✅ Correct: `"logins_count": "47"`
   - ❌ Wrong: `"logins_count": 47`
   - The exporter converts all booleans, numbers, arrays, and objects to string representations

2. **Reserved field names**
   - Fields like `organization_id`, `organization_name`, `org_id`, `org_name` conflict with WorkOS organization handling
   - The exporter automatically renames these with `auth0_` prefix (e.g., `organization_id` → `auth0_organization_id`)

3. **Arrays and objects**
   - Converted to JSON strings: `["admin"]` → `"[\"admin\"]"`
   - This preserves the data while meeting WorkOS string-only requirement

**Why this matters**: Without proper sanitization, WorkOS import will fail with `metadata_required` validation errors even when metadata is present.

## Password Migration (Optional)

**Important**: Auth0 does NOT provide password hashes via the Management API. Password migration requires a separate process:

1. **Request password export** from Auth0 support (1-week processing time)
2. **Export users** using this tool (without passwords)
3. **Merge passwords** using the password merge tool
4. **Import to WorkOS** with password hashes included

### Quick Start

```bash
# Step 1: Export users (no passwords)
npx tsx bin/export-auth0.ts \
  --domain tenant.auth0.com \
  --client-id YOUR_ID \
  --client-secret YOUR_SECRET \
  --output auth0-users.csv

# Step 2: Request passwords from Auth0 support
# (Open support ticket, wait 1-7 days for auth0-passwords.ndjson)

# Step 3: Merge password hashes into CSV
npx tsx bin/merge-auth0-passwords.ts \
  --csv auth0-users.csv \
  --passwords auth0-passwords.ndjson \
  --output auth0-users-with-passwords.csv

# Step 4: Import to WorkOS
npx tsx bin/import-users.ts \
  --csv auth0-users-with-passwords.csv
```

### Requirements

- ✅ Auth0 **paid plan** (password exports not available on free plans)
- ✅ Support ticket access
- ✅ 1-week processing time for password export

### What Gets Migrated

When passwords are included:
- ✅ Users can log in with existing passwords (no reset required)
- ✅ Bcrypt hashes migrated directly (Auth0 `$2b$` → WorkOS bcrypt)
- ✅ Algorithm automatically detected

Without passwords:
- ⚠️ Users must reset passwords on first login
- ✅ Simpler migration process
- ✅ More secure (no password hash transport)

**📖 See [PASSWORD-MIGRATION-GUIDE.md](./PASSWORD-MIGRATION-GUIDE.md) for complete details**

## Multi-Organization Memberships

**NEW in v2.1**: The WorkOS importer now supports users belonging to multiple organizations via multiple CSV rows.

### How Auth0 Exports Handle Multi-Org

Auth0's organization system allows users to belong to multiple organizations. The exporter handles this by **creating one row per user per organization**:

```csv
email,first_name,last_name,email_verified,external_id,org_external_id,org_name
alice@example.com,Alice,Smith,true,auth0|123,acme-corp,Acme Corporation
alice@example.com,Alice,Smith,true,auth0|123,beta-inc,Beta Inc
alice@example.com,Alice,Smith,true,auth0|123,gamma-llc,Gamma LLC
```

In this example:
- Alice is a member of 3 Auth0 organizations
- The exporter creates 3 CSV rows (one per membership)
- All rows have identical user data (email, name, external_id)

### Import Behavior

When importing the multi-org CSV:

**First row (Alice + Acme)**:
- Creates user `alice@example.com` in WorkOS
- Creates membership in Acme Corporation
- Summary: `Users created: 1`, `Memberships created: 1`

**Second row (Alice + Beta)**:
- Detects duplicate user (same email)
- Reuses existing user ID
- Creates new membership in Beta Inc
- Summary: `Users created: 1`, `Duplicate users: 1`, `Memberships created: 2`

**Third row (Alice + Gamma)**:
- Detects duplicate user (same email)
- Reuses existing user ID
- Creates new membership in Gamma LLC
- Summary: `Users created: 1`, `Duplicate users: 2`, `Memberships created: 3`

**Final result**: One user (Alice) with three memberships (Acme, Beta, Gamma) ✅

### Conflict Detection

The importer automatically detects and handles conflicts:

**User Data Conflicts:**
If user data differs between rows (e.g., different first_name), a warning is logged:
```
Warning: Row 3: Duplicate user alice@example.com - using existing user, ignoring new user data
```

**Recommendation**: Ensure user data is consistent across all rows for the same email.

**Duplicate Memberships:**
If the same user+org combination appears multiple times:
```
Warning: Row 5: Membership already exists for alice@example.com in org acme-corp - skipping
```

The duplicate is tracked in the summary but does not cause an error.

### Auth0 Membership Export

The Auth0 exporter fetches memberships by iterating through organizations:

1. **List all organizations** via Auth0 Management API
2. **For each organization**, get all members
3. **For each member**, export a CSV row with org context

This ensures:
- ✅ All memberships are captured
- ✅ Users in multiple orgs appear multiple times
- ✅ Organization data is included in each row

### Example Export Flow

**Auth0 Structure:**
```
Organizations:
  - acme-corp (10 members)
  - beta-inc (15 members)
  - gamma-llc (8 members)

Users:
  - alice@example.com (member of: acme-corp, beta-inc, gamma-llc)
  - bob@example.com (member of: acme-corp)
  - charlie@example.com (member of: beta-inc, gamma-llc)
```

**Exported CSV (33 rows total):**
```csv
email,first_name,last_name,org_external_id,org_name
alice@example.com,Alice,Smith,acme-corp,Acme Corporation
bob@example.com,Bob,Jones,acme-corp,Acme Corporation
... (8 more acme-corp members)
alice@example.com,Alice,Smith,beta-inc,Beta Inc
charlie@example.com,Charlie,Brown,beta-inc,Beta Inc
... (13 more beta-inc members)
alice@example.com,Alice,Smith,gamma-llc,Gamma LLC
charlie@example.com,Charlie,Brown,gamma-llc,Gamma LLC
... (6 more gamma-llc members)
```

**Import Summary:**
```
Users created: 3 (Alice, Bob, Charlie)
Duplicate users: 30 (Alice appears 2 extra times, Charlie appears 1 extra time)
Memberships created: 33 (total org memberships)
```

### Best Practices

**1. Keep User Data Consistent**

Ensure all rows for the same user have identical data:
```csv
# Good ✅
alice@example.com,Alice,Smith,true,auth0|123,acme-corp,Acme
alice@example.com,Alice,Smith,true,auth0|123,beta-inc,Beta

# Bad ❌ (inconsistent first_name)
alice@example.com,Alice,Smith,true,auth0|123,acme-corp,Acme
alice@example.com,Alicia,Smith,true,auth0|123,beta-inc,Beta
```

**2. Use Consistent External IDs**

The same user should have the same external_id across all rows:
```csv
# Good ✅
alice@example.com,Alice,Smith,auth0|123,acme-corp
alice@example.com,Alice,Smith,auth0|123,beta-inc

# Bad ❌ (different external_ids)
alice@example.com,Alice,Smith,auth0|123,acme-corp
alice@example.com,Alice,Smith,auth0|456,beta-inc
```

**3. Review Warnings**

After import, check for user data conflict warnings:
```bash
# View import logs
grep "Duplicate user" import.log

# Or check summary statistics
cat .workos-checkpoints/{job-id}/checkpoint.json | jq '.summary'
```

### Testing Multi-Org Exports

Test the export with a small subset first:

```bash
# Export specific organizations for testing
npx tsx bin/export-auth0.ts \
  --domain tenant.auth0.com \
  --client-id YOUR_CLIENT_ID \
  --client-secret YOUR_CLIENT_SECRET \
  --output test-export.csv \
  --orgs org_abc123 org_def456

# Import test data
npx tsx bin/import-users.ts \
  --csv test-export.csv \
  --dry-run

# Review summary for multi-membership stats
```

### Troubleshooting

**Issue: More rows than expected**

If you see many duplicate user warnings:
```bash
# Count unique emails
cut -d',' -f1 export.csv | sort -u | wc -l

# Count total rows
wc -l export.csv
```

Difference indicates users with multiple org memberships.

**Issue: Membership creation fails**

If memberships fail with 409 errors:
```
Error: Membership already exists
```

This can happen if:
- Running import multiple times with same data
- User manually added to org in WorkOS dashboard

**Solution**: The importer now handles 409 gracefully - duplicate memberships are tracked but don't cause failures.

## Performance

### Export Speed

Typical performance metrics (with default 50 rps rate limit):
- **10K users**: ~2 minutes
- **50K users**: ~8 minutes
- **100K users**: ~15 minutes

Performance depends on:
- **Auth0 API rate limits**: Exporter automatically adapts to your plan tier
  - Free (2 rps): ~10x slower than default
  - Developer (50 rps): Default speed
  - Enterprise (100+ rps): Up to 2x faster than default
- **Organization count**: More orgs = more API calls
- **Network latency**: Geographic distance to Auth0 servers

### Rate Limiting Impact

The built-in rate limiter ensures you **never hit Auth0 rate limits**, while maintaining maximum safe throughput:

- **Prevents slowdowns**: No 429 errors that trigger exponential backoff delays
- **Optimal speed**: Rate set to just below your Auth0 limit for maximum throughput
- **Predictable timing**: Consistent export speed regardless of Auth0 load
- **No manual tuning**: Automatically spaces requests to match your configured rate

### Memory Usage

The exporter uses streaming, so memory usage remains constant regardless of dataset size:
- **10K users**: ~50 MB
- **100K users**: ~50 MB (same!)
- **1M users**: ~50 MB (same!)

## Troubleshooting

### Error: "Insufficient scope"

**Cause**: M2M application doesn't have required Auth0 Management API permissions.

**Solution**:
1. Go to Auth0 Dashboard → Applications → Your M2M App
2. APIs tab → Auth0 Management API → Permissions
3. Enable: `read:users`, `read:organizations`, `read:organization_members`

### Error: "Connection test failed"

**Cause**: Invalid credentials or network issues.

**Solution**:
1. Verify domain, client ID, and client secret
2. Check that domain doesn't include `https://` (use `mycompany.auth0.com`)
3. Test Auth0 connectivity: `curl https://YOUR_DOMAIN/api/v2/`

### Warning: "Skipped users without email"

**Cause**: Some Auth0 users don't have an email address.

**Impact**: These users cannot be imported to WorkOS (email is required).

**Solution**:
- Review Auth0 user database for users without emails
- Consider adding placeholder emails (e.g., `user123@placeholder.com`)
- Or exclude these users from migration

### Error: "Rate limit exceeded"

**Cause**: Auth0 API rate limit hit.

**Solution**:
The exporter now includes **automatic rate limiting and retry logic** to prevent this error:

1. **Set correct rate limit for your plan**:
   ```bash
   # Free tier (2 rps)
   --rate-limit 2

   # Developer tier (50 rps) - default
   --rate-limit 50

   # Enterprise (100+ rps)
   --rate-limit 100
   ```

2. **Automatic retries**: If rate limited despite the limiter, the exporter automatically retries with exponential backoff and respects Auth0's `Retry-After` header

3. **Additional options** (if still experiencing issues):
   - Use `--page-size 50` to further reduce request frequency
   - Export during off-peak hours
   - Contact Auth0 support to increase rate limits

### Import Error: "metadata_required"

**Cause**: WorkOS metadata validation failed. Common reasons:
1. Metadata contains non-string values (booleans, numbers, arrays, objects)
2. Metadata contains reserved field names (`organization_id`, `organization_name`)

**Solution**:
- ✅ Use the latest version of the Auth0 exporter (includes automatic sanitization)
- If using an older export, re-export with the updated exporter
- The exporter now automatically converts all metadata values to strings and renames conflicting fields

**How to verify**: Check your CSV metadata column. If you see:
- `"department":"Engineering","active":true` ❌ (boolean value)
- `"department":"Engineering","active":"true"` ✅ (string value)

### Import Error: "external_id already assigned"

**Cause**: User or organization external_ids already exist in WorkOS from previous import attempts.

**Solution**:
- Delete existing users/organizations from WorkOS dashboard
- Or modify external_ids to be unique (add suffix like `_test1`, `_migration2`)
- For testing: Use the `make-unique.cjs` script to add timestamps to external_ids

## Example Workflow

### Complete Auth0 → WorkOS Migration

```bash
# Step 1: Export from Auth0
npx tsx bin/export-auth0.ts \
  --domain mycompany.auth0.com \
  --client-id YOUR_CLIENT_ID \
  --client-secret YOUR_CLIENT_SECRET \
  --output auth0-users.csv

# Step 2: Validate the export (Phase 2 feature)
# npx tsx bin/validate-csv.ts --csv auth0-users.csv

# Step 3: Import to WorkOS
npx tsx bin/import-users.ts \
  --csv auth0-users.csv \
  --concurrency 10 \
  --errors-out import-errors.jsonl

# Step 4: Analyze errors (if any)
# npx tsx bin/analyze-errors.ts \
#   --errors import-errors.jsonl \
#   --output retry.csv
```

## API Reference

### Programmatic Usage

```typescript
import { Auth0Exporter } from './src/exporters/auth0/auth0Exporter.js';

const exporter = new Auth0Exporter({
  credentials: {
    type: 'auth0',
    domain: 'mycompany.auth0.com',
    clientId: 'YOUR_CLIENT_ID',
    clientSecret: 'YOUR_CLIENT_SECRET'
  },
  outputPath: './auth0-export.csv',
  pageSize: 100,
  quiet: false,
  onProgress: (stats) => {
    console.log(`Exported ${stats.usersProcessed} users`);
  }
});

// Validate connection
const validation = await exporter.validate();
if (!validation.valid) {
  console.error('Validation failed:', validation.errors);
  process.exit(1);
}

// Execute export
const result = await exporter.export();
console.log(`Exported ${result.summary.totalUsers} users in ${result.summary.durationMs}ms`);
```

## Configuration Options

### ExporterConfig

```typescript
interface ExporterConfig {
  credentials: Auth0Credentials;    // Required
  outputPath: string;                // Required
  pageSize?: number;                 // Default: 100, Max: 100
  organizationFilter?: string[];     // Filter to specific org IDs
  quiet?: boolean;                   // Suppress output (default: false)
  onProgress?: (stats) => void;      // Progress callback
}
```

### Auth0Credentials

```typescript
interface Auth0Credentials {
  type: 'auth0';
  domain: string;                    // e.g., mycompany.auth0.com
  clientId: string;                  // M2M application client ID
  clientSecret: string;              // M2M application client secret
  audience?: string;                 // Default: https://{domain}/api/v2/
}
```

## Next Steps

After exporting from Auth0:

1. **Validate** (Phase 2): Check CSV for issues before import
   ```bash
   npx tsx bin/validate-csv.ts --csv auth0-export.csv
   ```

2. **Transform** (Phase 3): Apply custom field mappings if needed
   ```bash
   npx tsx bin/map-fields.ts \
     --input auth0-export.csv \
     --output workos-ready.csv \
     --profile auth0
   ```

3. **Import** (existing): Load users into WorkOS
   ```bash
   npx tsx bin/import-users.ts \
     --csv auth0-export.csv \
     --concurrency 10
   ```

## Support

For issues with the Auth0 exporter:
1. Check [troubleshooting section](#troubleshooting) above
2. Review Auth0 Management API documentation
3. Open an issue in the repository

For Auth0-specific issues:
- Contact Auth0 support
- Check Auth0 community forums
- Review Auth0 status page for outages
