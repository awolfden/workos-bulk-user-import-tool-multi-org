# WorkOS Multi-Org Migration Toolkit

Migrate users from Auth0, Clerk, Firebase (or any IdP) to WorkOS with support for multi-organization setups, password migration, and million+ user scale.

## What Is This?

A comprehensive toolkit for migrating users to WorkOS User Management:

- **Multi-Organization**: Import users across 1000+ organizations in a single CSV
- **Password Migration**: Migrate bcrypt, Auth0, and Okta password hashes
- **Wizard-Driven**: Interactive step-by-step guidance through the entire process
- **Large Scale**: Built for 1M+ users with checkpointing and parallel processing
- **Error Recovery**: Detailed error analysis and automatic retry generation

## Quick Start

### Option 1: Wizard (Recommended)

Interactive guided migration from start to finish:

```bash
WORKOS_SECRET_KEY=sk_test_123 npx tsx bin/migrate-wizard.ts
```

The wizard walks you through export, validation, and import with automatic error handling.

👉 **[Wizard Guide](docs/getting-started/WIZARD.md)** - Complete walkthrough

### Option 2: Direct Import

If you already have a CSV file ready:

```bash
WORKOS_SECRET_KEY=sk_test_123 npx tsx bin/import-users.ts --csv users.csv
```

👉 **[Quick Start Guide](docs/getting-started/QUICK-START.md)** - Direct command usage

## Migration Workflow

```
┌────────────┐   ┌──────────┐   ┌─────────┐   ┌──────────┐   ┌────────┐
│ 1. Export  │ → │ 2. Map   │ → │ 3. Fix  │ → │ 4. Test  │ → │ 5. Go! │
│  from Auth0│   │  Fields  │   │  Errors │   │  Dry Run│   │  Import│
└────────────┘   └──────────┘   └─────────┘   └──────────┘   └────────┘
```

## Phases Overview

| Phase | What It Does | Command | Documentation |
|-------|--------------|---------|---------------|
| **1. Export** | Download users from Auth0 | `bin/export-auth0.ts` | [Export Guide](docs/phases/01-EXPORT.md) |
| **2. Validate** | Check CSV for errors | `bin/validate-csv.ts` | [Validation Guide](docs/phases/02-VALIDATE.md) |
| **3. Map** | Transform fields | `bin/map-fields.ts` | [Mapping Guide](docs/phases/03-MAP.md) |
| **4. Analyze** | Review errors, plan fixes | `bin/analyze-errors.ts` | [Analysis Guide](docs/phases/04-ANALYZE.md) |
| **5. Import** | Migrate to WorkOS | `bin/import-users.ts` | [Import Guide](docs/phases/05-IMPORT.md) |
| **6. TOTP** | Enroll MFA factors | `bin/enroll-totp.ts` | [TOTP Guide](#migrating-totp-mfa-factors) |

## Key Features

- ✅ **Wizard-Driven** - Interactive guidance through entire process
- ✅ **Multi-Organization** - Import users across 1000+ organizations in one CSV
- ✅ **Password Migration** - Bcrypt, Auth0, Firebase (scrypt), Okta formats supported
- ✅ **TOTP Migration** - Enroll existing TOTP secrets so users keep their authenticator apps
- ✅ **Email Deduplication** - Intelligently merge duplicate emails (common with Auth0)
- ✅ **Resumable** - Checkpoint large imports, resume on failure
- ✅ **Parallel Processing** - 4x faster with worker pool (100K users in ~20 minutes)
- ✅ **Error Recovery** - Detailed analysis, automatic retry CSV generation
- ✅ **Pre-Warming** - Eliminate race conditions for multi-org imports

## Common Use Cases

### Migrating from Auth0

Use the wizard for guided migration:

```bash
WORKOS_SECRET_KEY=sk_test_123 npx tsx bin/migrate-wizard.ts
```

👉 **[Wizard Guide](docs/getting-started/WIZARD.md)**

### Migrating from Clerk

Use the wizard or the CLI directly:

```bash
npx tsx bin/transform-clerk.ts \
  --clerk-csv clerk-export.csv \
  --org-mapping clerk-org-mapping.csv \
  --output workos-users.csv
```

👉 **[Clerk Migration Guide](docs/guides/CLERK-MIGRATION.md)**

### Migrating from Firebase

Use the wizard or the CLI directly:

```bash
npx tsx bin/transform-firebase.ts \
  --firebase-json users.json \
  --signer-key "<base64_signer_key>" \
  --org-mapping firebase-org-mapping.csv \
  --output workos-users.csv
```

👉 **[Firebase Migration Guide](docs/guides/FIREBASE-MIGRATION.md)**

### Multi-Organization Import

CSV with `org_external_id` column for automatic multi-org mode:

```bash
WORKOS_SECRET_KEY=sk_test_123 \
  npx tsx bin/import-users.ts --csv multi-org-users.csv --workers 4
```

👉 **[Multi-Org Guide](docs/guides/MULTI-ORG.md)**

### Large Scale (100K+ users)

Chunked mode with workers for optimal performance:

```bash
WORKOS_SECRET_KEY=sk_test_123 \
  npx tsx bin/import-users.ts \
    --csv users.csv \
    --job-id prod-migration \
    --workers 4 \
    --chunk-size 1000
```

👉 **[Large Scale Guide](docs/advanced/CHUNKING-RESUMABILITY.md)**

### Migrating TOTP MFA Factors

After importing users, enroll their existing TOTP secrets so they can keep using their authenticator apps without re-enrolling:

```bash
# From a CSV with email + totp_secret columns
WORKOS_SECRET_KEY=sk_test_123 \
  npx tsx bin/enroll-totp.ts --input totp-secrets.csv

# From an NDJSON export (e.g. from Auth0 support)
WORKOS_SECRET_KEY=sk_test_123 \
  npx tsx bin/enroll-totp.ts --input auth0-mfa-export.ndjson --format ndjson

# Dry run first to verify user lookups
WORKOS_SECRET_KEY=sk_test_123 \
  npx tsx bin/enroll-totp.ts --input totp-secrets.csv --dry-run
```

**TOTP CSV format:**

```csv
email,totp_secret,totp_issuer,totp_user
alice@example.com,JBSWY3DPEHPK3PXP,MyApp,alice@example.com
```

Secrets must be Base32-encoded and compatible with SHA1 / 6-digit / 30-second TOTP.

**Getting TOTP secrets from Auth0:** Auth0 does not expose TOTP secrets via their Management API. You need to file a support ticket requesting an MFA enrollment export, similar to how password hash exports work.

## Installation

```bash
git clone <repo-url>
cd workos-bulk-user-import-tool-multi-org
npm install
```

**Requirements:** Node.js 18+

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

👉 **[CSV Format Reference](docs/guides/CSV-FORMAT.md)** - Complete column reference

## Troubleshooting

**Errors during import?**
→ See [Troubleshooting Guide](docs/guides/TROUBLESHOOTING.md)

**Password migration questions?**
→ See [Password Migration Guide](docs/guides/PASSWORD-MIGRATION.md)

**Multi-org setup?**
→ See [Multi-Org Guide](docs/guides/MULTI-ORG.md)

**Performance optimization?**
→ See [Worker Pool Guide](docs/advanced/WORKER-POOL.md)

## Documentation

- **[Getting Started](docs/getting-started/)** - Quick start and wizard guides
- **[Phases](docs/phases/)** - Detailed phase-by-phase documentation
- **[Guides](docs/guides/)** - How-to guides for specific scenarios
- **[Advanced](docs/advanced/)** - Technical deep-dives and optimization

👉 **[Full Documentation](docs/README.md)**

## Performance

| Users | Duration* | Memory | Recommended Config |
|-------|-----------|--------|-------------------|
| 1K | ~30-40s | <50 MB | Default settings |
| 10K | ~3-4 min | ~50 MB | Default settings |
| 50K | ~15-20 min | ~75 MB | `--workers 2` |
| 100K | ~20-30 min | ~100 MB | `--workers 4 --job-id migration` |
| 1M+ | ~3-4 hours | ~100 MB | `--workers 4 --chunk-size 5000` |

\* With 4 workers and WorkOS 50 req/sec limit

## Example Commands

```bash
# Wizard (recommended for first-time users)
npx tsx bin/migrate-wizard.ts

# Export from Auth0
npx tsx bin/export-auth0.ts \
  --domain dev-example.us.auth0.com \
  --client-id <id> \
  --client-secret <secret>

# Validate CSV
npx tsx bin/validate-csv.ts --csv users.csv --auto-fix

# Simple import
npx tsx bin/import-users.ts --csv users.csv

# Multi-org import with workers
npx tsx bin/import-users.ts \
  --csv users.csv \
  --job-id migration-prod \
  --workers 4

# Resume interrupted import
npx tsx bin/import-users.ts --resume migration-prod

# Dry-run (test without API calls)
npx tsx bin/import-users.ts --csv users.csv --dry-run
```

## Support

- **Issues**: [GitHub Issues](../../issues)
- **Questions**: [GitHub Discussions](../../discussions)
- **Docs**: [Full Documentation](docs/README.md)

## Related Repositories

- **[Single-Org Tool](https://github.com/awolfden/workos-bulk-user-import-tool)** - Simpler version for single-organization imports

## License

MIT

---

**New to this tool?** Start with the **[Wizard Guide](docs/getting-started/WIZARD.md)** for interactive step-by-step guidance.
