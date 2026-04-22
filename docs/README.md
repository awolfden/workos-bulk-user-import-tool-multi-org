# Documentation

Complete documentation for the WorkOS Migration Toolkit.

## New to the Toolkit?

**Start with the Wizard** (recommended):

```bash
WORKOS_SECRET_KEY=sk_test_123 npx tsx bin/migrate-wizard.ts
```

See the [Wizard Guide](getting-started/WIZARD.md) for a full walkthrough.

**Already have a CSV?** See the [Quick Start Guide](getting-started/QUICK-START.md).

## Migration Phases

Follow these phases in order for a complete migration:

1. **[Export](phases/01-EXPORT.md)** — Download users from Auth0 (or [transform from Clerk](guides/CLERK-MIGRATION.md) / [Firebase](guides/FIREBASE-MIGRATION.md))
2. **[Validate](phases/02-VALIDATE.md)** — Check CSV for errors before importing
3. **[Map](phases/03-MAP.md)** — Transform fields (optional)
4. **[Analyze](phases/04-ANALYZE.md)** — Review and fix errors (if needed)
5. **[Import](phases/05-IMPORT.md)** — Migrate users to WorkOS

## How-To Guides

- **[CSV Format Reference](guides/CSV-FORMAT.md)** — Complete column reference
- **[Multi-Organization Imports](guides/MULTI-ORG.md)** — Import across multiple organizations
- **[Email Deduplication](guides/DEDUPLICATION.md)** — Merge duplicate email addresses
- **[Password Migration](guides/PASSWORD-MIGRATION.md)** — Migrate password hashes
- **[Metadata Guide](guides/METADATA.md)** — WorkOS metadata best practices
- **[Clerk Migration](guides/CLERK-MIGRATION.md)** — Migrate users from Clerk
- **[Firebase Migration](guides/FIREBASE-MIGRATION.md)** — Migrate users from Firebase
- **[Role Mapping](guides/ROLE-MAPPING.md)** — Migrate roles and permissions
- **[Troubleshooting](guides/TROUBLESHOOTING.md)** — Common errors and solutions

## Advanced Topics

- **[Chunking & Resumability](advanced/CHUNKING-RESUMABILITY.md)** — Large imports with checkpoints
- **[Worker Pool](advanced/WORKER-POOL.md)** — Parallel processing (4x faster)
- **[Cache Pre-Warming](advanced/PRE-WARMING.md)** — Eliminate race conditions
- **[Performance Guide](advanced/PERFORMANCE.md)** — Optimization and benchmarks

## Quick Reference

### Common Commands

```bash
# Wizard (recommended for first-time users)
npx tsx bin/migrate-wizard.ts

# Pre-flight check
npx tsx bin/import-users.ts --csv users.csv --plan

# Simple import
npx tsx bin/import-users.ts --csv users.csv

# Dry-run (test without API calls)
npx tsx bin/import-users.ts --csv users.csv --dry-run

# Multi-org import with workers
npx tsx bin/import-users.ts \
  --csv users.csv \
  --job-id migration-prod \
  --workers 4

# Resume interrupted import
npx tsx bin/import-users.ts --resume migration-prod

# Export from Auth0
npx tsx bin/export-auth0.ts \
  --domain <domain> \
  --client-id <id> \
  --client-secret <secret>

# Transform Clerk export
npx tsx bin/transform-clerk.ts \
  --clerk-csv clerk-export.csv \
  --output workos-users.csv

# Validate CSV
npx tsx bin/validate-csv.ts --csv users.csv
```

### By Use Case

| Use Case | Guide |
|----------|-------|
| Migrating from Auth0 | [Wizard Guide](getting-started/WIZARD.md) or [Export Phase](phases/01-EXPORT.md) |
| Migrating from Clerk | [Clerk Migration Guide](guides/CLERK-MIGRATION.md) |
| Migrating from Firebase | [Firebase Migration Guide](guides/FIREBASE-MIGRATION.md) |
| Already have a CSV | [Quick Start Guide](getting-started/QUICK-START.md) |
| Multi-organization setup | [Multi-Org Guide](guides/MULTI-ORG.md) |
| Large imports (100K+) | [Worker Pool Guide](advanced/WORKER-POOL.md) |
| Errors during import | [Troubleshooting Guide](guides/TROUBLESHOOTING.md) |
| Migrating roles & permissions | [Role Mapping Guide](guides/ROLE-MAPPING.md) |
| Password migration | [Password Migration Guide](guides/PASSWORD-MIGRATION.md) |

---

**Quick Links:**
[Wizard](getting-started/WIZARD.md) | [Quick Start](getting-started/QUICK-START.md) | [Import](phases/05-IMPORT.md) | [Troubleshooting](guides/TROUBLESHOOTING.md) | [Multi-Org](guides/MULTI-ORG.md)
