# CSV Format Reference

Complete reference for CSV file format used by the WorkOS Migration Toolkit.

## Required Columns

### `email`

**Required:** Yes
**Format:** Valid email address
**Example:** `alice@example.com`

The email address uniquely identifies the user.

## Optional User Columns

### `first_name`

**Format:** String
**Example:** `Alice`

User's first name.

### `last_name`

**Format:** String
**Example:** `Smith`

User's last name.

### `email_verified`

**Format:** Boolean (true/false, yes/no, 1/0)
**Case-insensitive:** Yes
**Example:** `true`, `yes`, `1`

Whether the user's email has been verified.

### `external_id`

**Format:** String
**Example:** `auth0|abc123`, `user-001`

Your external identifier for this user (e.g., Auth0 user ID).

### `password`

**Format:** Plain text password (discouraged)
**Example:** `mySecretPassword123`

**Note:** If both `password` and `password_hash` are present, `password_hash` takes precedence and `password` is ignored.

### `password_hash`

**Format:** Hashed password string
**Example:** `$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy`

Pre-hashed password. Must be used with `password_hash_type`.

### `password_hash_type`

**Format:** Hash algorithm name
**Valid values:** `bcrypt`, `auth0`, `okta-bcrypt`
**Example:** `bcrypt`

Specifies the password hash algorithm. Required when `password_hash` is provided.

See [Auth0 Migration Guide](AUTH0-MIGRATION.md#password-hash-formats) for supported formats.

### `metadata`

**Format:** JSON string
**Example:** `{"role":"admin","team":"eng"}`

Custom metadata as JSON. Must be valid JSON. Invalid JSON causes row to fail.

**Important:**
- Use double quotes for JSON (not single quotes)
- Empty string is ignored (no metadata)
- Nested objects and arrays supported

## Organization Columns (Multi-Org Mode)

### `org_id`

**Format:** WorkOS organization ID
**Example:** `org_abc123xyz`

Direct WorkOS organization ID. Fastest option, no API lookup needed.

### `org_external_id`

**Format:** Your external organization identifier
**Example:** `acme-corp`, `org_12345`

Your external identifier for the organization. Triggers API lookup (cached).

### `org_name`

**Format:** Organization name
**Example:** `Acme Corporation`

Organization display name. Used when creating new organizations.

**When creating orgs:**
- Required if organization doesn't exist
- Ignored if organization already exists
- Used with `org_external_id` for creation

## Column Name Mapping

CSV columns use `snake_case` and map to WorkOS fields:

| CSV Column | WorkOS Field |
|------------|--------------|
| `email` | `email` |
| `first_name` | `firstName` |
| `last_name` | `lastName` |
| `email_verified` | `emailVerified` |
| `external_id` | `externalId` |
| `password_hash` | `passwordHash` |
| `password_hash_type` | `passwordHashType` |
| `metadata` | `metadata` |

## Basic Examples

### Minimal CSV

```csv
email
alice@example.com
bob@example.com
```

### With Names and Verification

```csv
email,first_name,last_name,email_verified
alice@example.com,Alice,Smith,true
bob@example.com,Bob,Jones,yes
```

### With Metadata

```csv
email,first_name,last_name,metadata
alice@example.com,Alice,Smith,"{""role"":""admin""}"
bob@example.com,Bob,Jones,"{""team"":""eng""}"
```

**Note:** CSV escapes double quotes as `""`.

### With Password Hashes

```csv
email,password_hash,password_hash_type
alice@example.com,$2a$10$N9qo...,bcrypt
bob@example.com,$2a$10$K7pL...,bcrypt
```

## Multi-Org Examples

### Single Organization per User

```csv
email,first_name,last_name,org_external_id,org_name
alice@acme.com,Alice,Smith,acme-corp,Acme Corporation
bob@acme.com,Bob,Jones,acme-corp,Acme Corporation
charlie@beta.com,Charlie,Brown,beta-inc,Beta Inc
```

### Multiple Organizations per User

Same email can appear in multiple rows for different organizations:

```csv
email,first_name,last_name,external_id,org_external_id,org_name
alice@example.com,Alice,Smith,user-001,acme-corp,Acme Corporation
alice@example.com,Alice,Smith,user-001,beta-inc,Beta Inc
alice@example.com,Alice,Smith,user-001,gamma-llc,Gamma LLC
```

**Result:**
- 1 user created
- 3 memberships created (one in each org)
- User data from first row used

See [Custom CSV Import Guide](CUSTOM-CSV-IMPORT.md#multi-organization-imports) for details.

### Using WorkOS Organization IDs

```csv
email,first_name,org_id
alice@example.com,Alice,org_abc123
bob@example.com,Bob,org_xyz789
```

No API lookup needed (fastest).

## Metadata

WorkOS has strict metadata validation rules. Understanding these requirements avoids common import failures.

### All Metadata Values Must Be Strings

WorkOS requires ALL metadata values to be strings. No exceptions.

**Forbidden types:**
- Booleans: `"active": true`
- Numbers: `"count": 42`
- Arrays: `"roles": ["admin", "user"]`
- Objects: `"settings": {"theme": "dark"}`

**Correct format:**
- String booleans: `"active": "true"`
- String numbers: `"count": "42"`
- JSON string arrays: `"roles": "[\"admin\",\"user\"]"`
- JSON string objects: `"settings": "{\"theme\":\"dark\"}"`

### Reserved Field Names

Certain field names conflict with WorkOS's internal organization handling and must not be used as metadata keys:

- `organization_id`
- `organization_name`
- `org_id`
- `org_name`
- `organizationId`
- `organizationName`

**Solution:** Rename with a prefix (e.g., `auth0_organization_id`).

### JSON Encoding Rules for CSV

When encoding metadata as JSON inside a CSV cell:

1. The JSON value must use double quotes (standard JSON)
2. Inside a CSV field, double quotes are escaped as `""` (CSV escaping rule)
3. The entire field should be wrapped in double quotes

**What works:**
```csv
email,first_name,last_name,email_verified,external_id,org_external_id,org_name,metadata
alice@acme.com,Alice,Smith,true,user_001,org_123,Acme Corp,"{""department"":""Engineering"",""active"":""true"",""count"":""42""}"
```

**What fails:**
```csv
email,first_name,last_name,email_verified,external_id,org_external_id,org_name,metadata
alice@acme.com,Alice,Smith,true,user_001,org_123,Acme Corp,"{""department"":""Engineering"",""active"":true,""count"":42}"
```

The second example fails with a `metadata_required` error (422 status code) because `active` and `count` are not strings.

### Best Practices for Metadata Columns

1. **Convert all metadata values to strings** before writing to CSV
2. **Avoid reserved field names** or rename them with a prefix
3. **Place the metadata column last** in your CSV, after all organization columns
4. **Test with small datasets first** -- validate 10-20 users before a full import
5. **Keep original values** -- sanitization preserves data (arrays become JSON strings)
6. **Document custom fields** -- note which fields were renamed (e.g., `org_id` to `auth0_org_id`)

### Sanitization Example

If building a custom exporter, sanitize metadata before writing:

```typescript
function sanitizeMetadataForWorkOS(metadata: Record<string, unknown>): Record<string, string> {
  const sanitized: Record<string, string> = {};

  for (const [key, value] of Object.entries(metadata)) {
    // Rename reserved fields
    if (['organization_id', 'organization_name', 'org_id', 'org_name'].includes(key)) {
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

## Validation Rules

### Email Column

- **Must exist** in every row
- Must be valid email format
- Case-insensitive for deduplication

### Boolean Columns

`email_verified` accepts:
- `true`, `false`
- `yes`, `no`
- `1`, `0`
- Case-insensitive

### JSON Columns

`metadata` must be:
- Valid JSON syntax
- Use double quotes
- Can be empty string (ignored)
- Invalid JSON fails the row

### Password Columns

- If `password_hash` provided, `password_hash_type` required
- If `password` and `password_hash` both present, `password_hash` wins
- Plain `password` discouraged for security

### Organization Columns

- Cannot have both `org_id` AND `org_external_id` in same row
- If `org_external_id` provided without `org_name`:
  - Organization must already exist
  - Error if not found
- If both `org_external_id` AND `org_name` provided:
  - Creates organization if missing
  - Updates name if exists (optional)

## Unknown Columns

Unknown columns are ignored with a warning. Example:

```csv
email,custom_field,another_field
alice@example.com,value1,value2
```

Output:
```
Warning: Unknown columns will be ignored: custom_field, another_field
```

## BOM (Byte Order Mark)

UTF-8 BOM is automatically handled. Excel-exported CSVs often include BOM.

## Line Endings

Both Unix (`\n`) and Windows (`\r\n`) line endings supported.

## Empty Values

- Empty strings are treated as null/missing
- Empty `metadata` is ignored (no metadata set)
- Empty required fields (like `email`) cause validation error

## Duplicate Detection

### Email Duplicates

Same email in multiple rows:
- First occurrence: Creates user
- Subsequent: Creates additional memberships
- User data from first row wins

### External ID Duplicates

Identical `external_id` in multiple rows:
- Should match same user
- Inconsistent with different emails causes a warning

## CSV Escaping

Standard CSV escaping rules:
- Fields with commas: Wrap in double quotes
- Fields with double quotes: Escape as `""`
- Fields with newlines: Wrap in double quotes

Example:
```csv
email,first_name,metadata
alice@example.com,Alice,"{""key"":""value, with comma""}"
```

## Maximum Sizes

- **Row count:** No limit (streaming processing)
- **Column count:** No limit (unknown columns ignored)
- **Cell size:** 2MB per cell (WorkOS API limit)
- **File size:** No limit (streaming)

## Tools for Validation

### Validate Before Import

```bash
npx workos-migrate validate --csv users.csv
```

### Auto-Fix Common Issues

```bash
npx workos-migrate validate \
  --csv users.csv \
  --auto-fix \
  --fixed-csv users-fixed.csv
```

Auto-fixes:
- Whitespace trimming
- Boolean formatting
- Empty value normalization

## Common Mistakes

### Mistake 1: Single Quotes in JSON

Wrong:
```csv
email,metadata
alice@example.com,"{'role':'admin'}"
```

Correct:
```csv
email,metadata
alice@example.com,"{""role"":""admin""}"
```

### Mistake 2: Both org_id and org_external_id

Wrong:
```csv
email,org_id,org_external_id
alice@example.com,org_123,acme-corp
```

Correct (choose one):
```csv
email,org_id
alice@example.com,org_123
```

### Mistake 3: Missing email_verified Value

Wrong:
```csv
email,email_verified
alice@example.com,
```

Correct:
```csv
email,email_verified
alice@example.com,false
```

### Mistake 4: Password Hash Without Type

Wrong:
```csv
email,password_hash
alice@example.com,$2a$10$...
```

Correct:
```csv
email,password_hash,password_hash_type
alice@example.com,$2a$10$...,bcrypt
```

### Mistake 5: Non-String Metadata Values

Wrong:
```csv
email,metadata
alice@example.com,"{""active"":true,""count"":42}"
```

Correct:
```csv
email,metadata
alice@example.com,"{""active"":""true"",""count"":""42""}"
```

## Example Files

See `examples/` directory:
- `examples/common/example-input.csv` - Basic examples
- `examples/common/multi-org-simple.csv` - Multi-org examples
- `examples/common/multi-org-multi-membership.csv` - Multi-membership examples

## Related Documentation

- [Custom CSV Import Guide](CUSTOM-CSV-IMPORT.md) - Import modes, multi-org, large-scale
- [Auth0 Migration Guide](AUTH0-MIGRATION.md) - Auth0 export, password hash formats
- [Role Mapping Guide](ROLE-MAPPING.md) - Role and permission migration
- [Troubleshooting](TROUBLESHOOTING.md) - Common errors and solutions
