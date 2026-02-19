# Role & Permission Mapping

Guide for migrating roles and permissions from your existing auth system to WorkOS.

## Overview

The role mapping feature lets you assign WorkOS roles to users during migration. This involves two steps:

1. **Role Definitions** — Create roles (and their permissions) in WorkOS
2. **User-Role Mapping** — Assign roles to users during import

Both steps are optional and independent. If your roles already exist in WorkOS, skip step 1. If role assignments are embedded in your user CSV (via a `role_slugs` column), you can skip the separate mapping CSV.

## Prerequisites

- **WorkOS API key** — Set `WORKOS_SECRET_KEY` environment variable
- **Role definitions CSV** (optional) — Defines roles and permissions to create in WorkOS
- **User-role mapping CSV** (optional) — Maps users to their role assignments

## Role Definitions CSV

Defines the roles that should exist in WorkOS before import.

### Format

```csv
role_slug,role_name,role_type,permissions
admin,Administrator,environment,"users:read,users:write,settings:manage"
editor,Editor,environment,"users:read,content:write"
org-admin,Org Administrator,organization,"members:manage,settings:read"
org-member,Member,organization,"content:read"
```

### Columns

| Column | Required | Description |
|--------|----------|-------------|
| `role_slug` | Yes | Unique identifier (lowercase, hyphens, underscores) |
| `role_name` | Yes | Human-readable display name |
| `role_type` | Yes | `environment` or `organization` |
| `permissions` | No | Comma-separated or JSON array of permission slugs |
| `org_id` | No | WorkOS org ID (for organization roles scoped to a specific org) |
| `org_external_id` | No | External org ID (resolved during processing) |

### Role Types

- **Environment roles** — Global roles that apply across your entire WorkOS environment
- **Organization roles** — Roles scoped to a specific organization. Each org role must specify which organization it belongs to via `org_id` or `org_external_id`. If you want the same role in multiple orgs, add one row per org.

### Organization Roles with External IDs

Organization roles in WorkOS are scoped to a specific organization, so the API requires the organization ID when creating the role. When migrating, you typically have external org IDs (from Clerk, Auth0, etc.) rather than WorkOS org IDs. The `--org-mapping` flag handles this:

1. You populate `org_external_id` in the role definitions CSV for each org role
2. You pass `--org-mapping` pointing to your org mapping CSV (the same one used for user import)
3. The tool resolves each `org_external_id` to a WorkOS org ID (creating orgs if they don't exist)
4. Org roles are then created in the correct organizations

```csv
role_slug,role_name,role_type,permissions,org_id,org_external_id
admin,Administrator,environment,"users:manage,settings:manage",,
org-admin,Org Admin,organization,"members:manage,settings:edit",,acme-corp
org-admin,Org Admin,organization,"members:manage,settings:edit",,globex-io
org-viewer,Viewer,organization,"content:read",,acme-corp
org-viewer,Viewer,organization,"content:read",,globex-io
```

### Processing Role Definitions

```bash
# Environment roles only (no org mapping needed)
npx tsx bin/process-role-definitions.ts \
  --definitions role-definitions.csv \
  --report role-definitions-report.json

# With organization roles (pass org mapping to resolve external IDs)
npx tsx bin/process-role-definitions.ts \
  --definitions role-definitions.csv \
  --org-mapping clerk-org-mapping.csv \
  --report role-definitions-report.json
```

The `--org-mapping` flag reads the org mapping CSV, extracts unique organizations, and resolves/creates them in WorkOS before creating org-scoped roles. This ensures org IDs are available when the WorkOS API requires them.

If a role with the same slug already exists, it is preserved (not overwritten). A warning is logged if the existing role has different permissions.

## User-Role Mapping CSV

Maps each user to one or more roles. Each row is a single user-role pair; users with multiple roles have multiple rows.

### Format

```csv
external_id,role_slug
user_01,admin
user_01,editor
user_02,org-member
user_03,org-admin
user_03,org-member
```

### Columns

| Column | Required | Description |
|--------|----------|-------------|
| `external_id` | Yes | The user's external ID (matches the CSV import) |
| `role_slug` | Yes | Role slug to assign |

Duplicate user+role pairs are automatically deduplicated with a warning.

### Inline Role Slugs

Alternatively, you can include a `role_slugs` column directly in your import CSV:

```csv
email,first_name,last_name,external_id,role_slugs
alice@example.com,Alice,Smith,user_01,"admin,editor"
bob@example.com,Bob,Jones,user_02,org-member
```

The `role_slugs` column accepts comma-separated values or a JSON array (`["admin","editor"]`).

When both inline `role_slugs` and a `--role-mapping` CSV are provided, they are merged (union, deduplicated).

## Option A: Wizard Flow

The migration wizard includes role configuration prompts:

```bash
WORKOS_SECRET_KEY=sk_test_123 npx tsx bin/migrate-wizard.ts
```

After selecting your source and import mode, the wizard asks:

1. **Do you have role/permission data to migrate?** — Yes/No
2. **Do you have a role definitions CSV?** — Yes/No → path
3. **Path to user-role mapping CSV** — Enter the mapping CSV path

The wizard automatically generates the correct commands with `--role-definitions` and `--role-mapping` flags.

## Option B: CLI Step-by-Step

### Step 1: Process Role Definitions (if needed)

```bash
# Without org roles:
npx tsx bin/process-role-definitions.ts \
  --definitions role-definitions.csv \
  --report role-definitions-report.json

# With org roles (Clerk example — pass the same org mapping CSV used for import):
npx tsx bin/process-role-definitions.ts \
  --definitions role-definitions.csv \
  --org-mapping clerk-org-mapping.csv \
  --report role-definitions-report.json
```

### Step 2: Transform (Clerk only)

```bash
npx tsx bin/transform-clerk.ts \
  --clerk-csv clerk-export.csv \
  --org-mapping clerk-org-mapping.csv \
  --role-mapping user-role-mapping.csv \
  --output workos-users.csv
```

For Clerk, the `--role-mapping` flag merges role slugs into the transformed CSV. The mapping CSV uses `clerk_user_id` as the join key.

### Step 3: Validate

```bash
npx tsx bin/validate-csv.ts \
  --csv workos-users.csv \
  --auto-fix \
  --fixed-csv users-validated.csv
```

The validator checks `role_slugs` format (lowercase alphanumeric with hyphens/underscores).

### Step 4: Import

```bash
npx tsx bin/import-users.ts \
  --csv users-validated.csv \
  --role-mapping user-role-mapping.csv
```

Or using the orchestrator:

```bash
npx tsx bin/orchestrate-migration.ts \
  --csv users-validated.csv \
  --role-definitions role-definitions.csv \
  --role-mapping user-role-mapping.csv
```

## Clerk-Specific Notes

When migrating from Clerk, the role mapping CSV uses `clerk_user_id` as the join key (not `external_id`), because at transform time the external_id hasn't been assigned yet.

```csv
clerk_user_id,role_slug
user_2abc123,admin
user_2abc123,editor
user_2def456,viewer
```

The `--role-mapping` flag on `transform-clerk` merges role slugs directly into the output CSV. During import, roles are assigned from the `role_slugs` column in the transformed CSV.

## Conflict Handling

- **Role already exists with same permissions** — Skipped, logged as "already exists"
- **Role already exists with different permissions** — Preserved as-is, warning logged with permission diff
- **Duplicate user-role pairs in mapping** — Deduplicated, warning logged
- **Invalid role slug during import** — Logged as role_assignment error, user still imported

## Environment vs Organization Roles

| Feature | Environment Role | Organization Role |
|---------|-----------------|-------------------|
| Scope | Entire WorkOS environment | Single organization |
| When to use | Global admin, super-admin | Org-level admin, member |
| `role_type` | `environment` | `organization` |
| Org columns needed? | No | Yes — `org_id` or `org_external_id` required |
| `--org-mapping` needed? | No | Yes, if using `org_external_id` |

## Troubleshooting

### "Role not found" during import

The role slug referenced in the mapping doesn't exist in WorkOS. Either:
- Run `process-role-definitions` first to create the role
- Create the role manually in the WorkOS dashboard

### "Invalid role slug" validation error

Role slugs must be lowercase alphanumeric with hyphens and underscores only:
- Valid: `admin`, `org-admin`, `content_editor`
- Invalid: `Admin`, `org admin`, `editor@v2`

### Role assignments not appearing

Check that:
1. The user has an organization membership (roles are assigned to memberships)
2. The `external_id` in the mapping CSV matches the user's external_id
3. For Clerk, the `clerk_user_id` matches the Clerk user ID

### Permission diff warnings

When a role already exists with different permissions, the existing role is preserved. Review the role definitions report for details on permission differences.

## Related Documentation

- [CSV Format Reference](CSV-FORMAT.md) — Complete column reference
- [Clerk Migration](CLERK-MIGRATION.md) — Clerk-specific migration guide
- [Multi-Organization Imports](MULTI-ORG.md) — Multi-org import details
- [Wizard Guide](../getting-started/WIZARD.md) — Interactive wizard walkthrough
