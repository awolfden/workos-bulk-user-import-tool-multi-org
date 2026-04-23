# WorkOS Migration Toolkit

Migrate users from Auth0, Clerk, Firebase (or any identity provider) to WorkOS.

## Quick Start

```bash
npm install
npx workos-migrate wizard
```

The wizard walks you through the entire migration — export, validation, and import.

## Already Have a CSV?

```bash
npx workos-migrate import --csv users.csv
```

See the [Custom CSV Import Guide](docs/guides/CUSTOM-CSV-IMPORT.md) for import modes, validation, and advanced options.

## What This Tool Does

- **Multi-Organization** — Import users across 1000+ organizations in a single CSV
- **Password Migration** — Migrate bcrypt, Auth0, Firebase (scrypt), and Okta password hashes
- **Large Scale** — Built for 1M+ users with checkpointing, parallel processing, and error recovery

## Migration Paths

| Path | Command | Guide |
|------|---------|-------|
| **Interactive Wizard** | `npx workos-migrate wizard` | [Wizard Guide](docs/guides/WIZARD.md) |
| **Auth0** | `npx workos-migrate export-auth0 ...` | [Auth0 Migration](docs/guides/AUTH0-MIGRATION.md) |
| **Clerk** | `npx workos-migrate transform-clerk ...` | [Clerk Migration](docs/guides/CLERK-MIGRATION.md) |
| **Firebase** | `npx workos-migrate transform-firebase ...` | [Firebase Migration](docs/guides/FIREBASE-MIGRATION.md) |
| **Custom CSV** | `npx workos-migrate import --csv ...` | [Custom CSV Import](docs/guides/CUSTOM-CSV-IMPORT.md) |
| **Roles & Permissions** | `npx workos-migrate process-roles ...` | [Role Mapping](docs/guides/ROLE-MAPPING.md) |

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

## Installation

```bash
git clone <repo-url>
cd workos-bulk-user-import-tool-multi-org
npm install
```

**Requirements:** Node.js 18+

Set your WorkOS API key:

```bash
export WORKOS_SECRET_KEY=sk_test_...
# Or add to .env file
echo 'WORKOS_SECRET_KEY=sk_test_...' > .env
```

## Documentation

| Guide | Description |
|-------|-------------|
| [Wizard Guide](docs/guides/WIZARD.md) | Interactive step-by-step migration |
| [Auth0 Migration](docs/guides/AUTH0-MIGRATION.md) | Export from Auth0, password hashes, multi-org |
| [Clerk Migration](docs/guides/CLERK-MIGRATION.md) | Transform Clerk exports, org/role mapping |
| [Firebase Migration](docs/guides/FIREBASE-MIGRATION.md) | Transform Firebase JSON, scrypt passwords |
| [Custom CSV Import](docs/guides/CUSTOM-CSV-IMPORT.md) | Direct import, validation, large-scale, workers |
| [CSV Format Reference](docs/guides/CSV-FORMAT.md) | All supported columns and metadata format |
| [Role Mapping](docs/guides/ROLE-MAPPING.md) | Role definitions and user-role assignments |
| [Troubleshooting](docs/guides/TROUBLESHOOTING.md) | Common errors, error analysis, deduplication |

## License

MIT
