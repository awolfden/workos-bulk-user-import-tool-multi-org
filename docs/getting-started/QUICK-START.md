# Quick Start Guide

Get started with the WorkOS Multi-Org Migration Toolkit in under 5 minutes.

## Prerequisites

- Node.js 18+ installed
- WorkOS Secret Key (found in your WorkOS Dashboard under API Keys)

**Important**: Never share or hardcode your Secret Key. Use environment variables or a `.env` file.

## Installation

```bash
git clone <repo-url>
cd workos-bulk-user-import-tool-multi-org
npm install
```

## Option 1: Simple Import (Pre-Prepared CSV)

If you already have a CSV file ready to import:

### One-time Import

Paste your key inline for a one-off import:

```bash
WORKOS_SECRET_KEY=sk_test_123 npx tsx bin/import-users.ts --csv path/to/users.csv
```

### Using .env File

For repeated imports, store your key in a `.env` file:

```bash
echo 'WORKOS_SECRET_KEY=sk_test_123' > .env
npx tsx bin/import-users.ts --csv path/to/users.csv
```

### Save Failed Rows

Optionally save failed rows to fix and retry later:

```bash
npx tsx bin/import-users.ts --csv path/to/users.csv --errors-out errors.csv
```

## Option 2: Use the Wizard

For a guided experience through the entire migration process, use the wizard:

```bash
WORKOS_SECRET_KEY=sk_test_123 npx tsx bin/migrate-wizard.ts
```

The wizard will walk you through:
1. Exporting from Auth0 (if needed)
2. Validating your CSV
3. Mapping fields
4. Testing with dry-run
5. Running the import

See [Wizard Guide](WIZARD.md) for detailed walkthrough.

## Import Modes

### User-Only Mode (No Organizations)

Import users without organization memberships:

```bash
WORKOS_SECRET_KEY=sk_test_123 \
  npx tsx bin/import-users.ts --csv examples/common/example-input.csv
```

### Single-Organization Mode

Add all users to one organization by WorkOS ID:

```bash
WORKOS_SECRET_KEY=sk_test_123 \
  npx tsx bin/import-users.ts \
    --csv examples/common/example-input.csv \
    --org-id org_123
```

Or by external ID (create if missing):

```bash
WORKOS_SECRET_KEY=sk_test_123 \
  npx tsx bin/import-users.ts \
    --csv examples/common/example-input.csv \
    --org-external-id acme-123 \
    --create-org-if-missing \
    --org-name "Acme Inc."
```

### Multi-Organization Mode

Import users across multiple organizations using CSV columns:

```bash
WORKOS_SECRET_KEY=sk_test_123 \
  npx tsx bin/import-users.ts --csv multi-org-users.csv
```

The tool automatically detects `org_external_id` or `org_id` columns and enables multi-org mode.

See [Multi-Org Guide](../guides/MULTI-ORG.md) for detailed information.

## CSV Format

Minimal CSV example:

```csv
email,first_name,last_name,email_verified
alice@example.com,Alice,Smith,true
bob@example.com,Bob,Jones,yes
```

See [CSV Format Reference](../guides/CSV-FORMAT.md) for all supported columns.

## Common Options

- `--csv <path>`: Path to CSV file (required)
- `--errors-out <path>`: Save errors to file (CSV or JSON)
- `--quiet`: Suppress per-row output
- `--dry-run`: Validate without API calls
- `--concurrency <n>`: Parallel requests (default: 10)

See [Import Phase Documentation](../phases/05-IMPORT.md) for all options.

## What Happens During Import

For each CSV row, the tool:
1. Validates required fields (email, etc.)
2. Parses metadata JSON (if present)
3. Creates the user in WorkOS
4. Creates organization membership (if org mode)
5. Retries rate-limited requests (HTTP 429)

## Exit Codes

- `0`: All rows succeeded
- Non-zero: Errors occurred

## Next Steps

- **Validate your CSV first**: See [Validation Guide](../phases/02-VALIDATE.md)
- **Migrate passwords**: See [Password Migration Guide](../guides/PASSWORD-MIGRATION.md)
- **Large imports**: See [Chunking & Resumability](../advanced/CHUNKING-RESUMABILITY.md)
- **Troubleshooting**: See [Troubleshooting Guide](../guides/TROUBLESHOOTING.md)

## Example Summary Output

```
┌──────────────────────────────────────┐
│ SUMMARY                              │
│ Status: Success                      │
│ Users imported: 100/100              │
│ Duration: 12.3 s                     │
│ Warnings: 0                          │
│ Errors: 0                            │
└──────────────────────────────────────┘
```

## Getting Help

- **Documentation**: [Full Docs](../README.md)
- **Issues**: GitHub Issues
- **Questions**: GitHub Discussions
