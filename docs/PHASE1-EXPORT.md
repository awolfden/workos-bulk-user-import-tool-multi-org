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

## Password Export (Optional)

**⚠️ Requires Special Permission**

Auth0 password hash export requires the `read:user_idp_tokens` scope, which is not granted by default. Contact Auth0 support to enable this feature.

If enabled, password hashes will be included in the export and mapped to WorkOS format:
- Auth0 bcrypt → WorkOS bcrypt
- Auth0 md5 → WorkOS md5
- Other Auth0 algorithms → WorkOS auth0 (for Auth0-specific formats)

## Performance

### Export Speed

Typical performance metrics:
- **10K users**: ~2 minutes
- **50K users**: ~8 minutes
- **100K users**: ~15 minutes

Performance depends on:
- Auth0 API rate limits (typically 50 req/sec)
- Organization count (more orgs = more API calls)
- Network latency

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

**Cause**: Auth0 API rate limit hit (typically 50 req/sec).

**Solution**:
- Use `--page-size 50` to reduce request frequency
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
