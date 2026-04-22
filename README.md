# WorkOS Migration Toolkit

Migrate users from Auth0, Clerk, Firebase (or any IdP) to WorkOS.

## Quick Start

```bash
npm install
WORKOS_SECRET_KEY=sk_test_123 npx tsx bin/migrate-wizard.ts
```

The wizard walks you through the entire migration — export, validation, and import.

## Already Have a CSV?

```bash
WORKOS_SECRET_KEY=sk_test_123 npx tsx bin/import-users.ts --csv users.csv
```

## What This Tool Does

- **Multi-Organization** — Import users across 1000+ organizations in a single CSV
- **Password Migration** — Migrate bcrypt, Auth0, Firebase (scrypt), and Okta password hashes
- **Large Scale** — Built for 1M+ users with checkpointing, parallel processing, and error recovery

## Source-Specific Guides

| Source | Guide |
|--------|-------|
| Auth0 | [Auth0 Migration](docs/phases/01-EXPORT.md) |
| Clerk | [Clerk Migration](docs/guides/CLERK-MIGRATION.md) |
| Firebase | [Firebase Migration](docs/guides/FIREBASE-MIGRATION.md) |
| Custom CSV | [CSV Format Reference](docs/guides/CSV-FORMAT.md) |

## CSV Format

Minimal example:

```csv
email,first_name,last_name,email_verified
alice@example.com,Alice,Smith,true
bob@example.com,Bob,Jones,yes
```

Multi-org example:

```csv
email,first_name,last_name,org_external_id,org_name
alice@acme.com,Alice,Smith,acme-corp,Acme Corporation
bob@beta.com,Bob,Jones,beta-inc,Beta Inc
```

See [CSV Format Reference](docs/guides/CSV-FORMAT.md) for all supported columns.

## Advanced Usage

<details>
<summary>Planning, workers, checkpointing, and automation</summary>

### Pre-Flight Check

Analyze your CSV and get recommendations before importing:

```bash
npx tsx bin/import-users.ts --csv users.csv --plan
```

### Parallel Processing

Use workers for large imports (50K+ users):

```bash
npx tsx bin/import-users.ts \
  --csv users.csv \
  --job-id prod-migration \
  --workers 4
```

### Checkpointing & Resume

Resume interrupted imports:

```bash
npx tsx bin/import-users.ts --resume prod-migration
```

### Automation

Skip interactive prompts for scripting/CI:

```bash
npx tsx bin/import-users.ts --csv users.csv --yes
```

### Role Migration

Create roles and assign them during import:

```bash
npx tsx bin/import-users.ts \
  --csv users.csv \
  --role-definitions roles.csv \
  --role-mapping user-roles.csv
```

See [Role Mapping Guide](docs/guides/ROLE-MAPPING.md) for details.

</details>

## Installation

```bash
git clone <repo-url>
cd workos-bulk-user-import-tool-multi-org
npm install
```

**Requirements:** Node.js 18+

## Troubleshooting

- **Errors during import?** See [Troubleshooting Guide](docs/guides/TROUBLESHOOTING.md)
- **Password questions?** See [Password Migration Guide](docs/guides/PASSWORD-MIGRATION.md)
- **Multi-org setup?** See [Multi-Org Guide](docs/guides/MULTI-ORG.md)

## Documentation

See [Full Documentation](docs/README.md) for detailed guides on every feature.

## License

MIT
