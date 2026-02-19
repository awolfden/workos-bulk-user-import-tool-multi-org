# Documentation

Complete documentation for the WorkOS Multi-Org Migration Toolkit.

## New to the Toolkit?

**Start here**: [Quick Start Guide](getting-started/QUICK-START.md)

**Or use the wizard**: [Wizard Guide](getting-started/WIZARD.md) (recommended for first-time users)

## Migration Phases

Follow these phases in order for a complete migration:

1. **[Export](phases/01-EXPORT.md)** - Download users from Auth0 (or [transform from Clerk](guides/CLERK-MIGRATION.md))
2. **[Validate](phases/02-VALIDATE.md)** - Check CSV for errors before importing
3. **[Map](phases/03-MAP.md)** - Transform fields (optional)
4. **[Analyze](phases/04-ANALYZE.md)** - Review and fix errors (if needed)
5. **[Import](phases/05-IMPORT.md)** - Migrate users to WorkOS

## How-To Guides

- **[CSV Format Reference](guides/CSV-FORMAT.md)** - Complete column reference
- **[Multi-Organization Imports](guides/MULTI-ORG.md)** - Import across multiple organizations
- **[Email Deduplication](guides/DEDUPLICATION.md)** - Merge duplicate email addresses
- **[Password Migration](guides/PASSWORD-MIGRATION.md)** - Migrate password hashes
- **[Metadata Guide](guides/METADATA.md)** - WorkOS metadata best practices
- **[Clerk Migration](guides/CLERK-MIGRATION.md)** - Migrate users from Clerk
- **[Role Mapping](guides/ROLE-MAPPING.md)** - Migrate roles and permissions
- **[Troubleshooting](guides/TROUBLESHOOTING.md)** - Common errors and solutions

## Advanced Topics

- **[Chunking & Resumability](advanced/CHUNKING-RESUMABILITY.md)** - Large imports with checkpoints
- **[Worker Pool](advanced/WORKER-POOL.md)** - Parallel processing (4x faster)
- **[Cache Pre-Warming](advanced/PRE-WARMING.md)** - Eliminate race conditions
- **[Performance Guide](advanced/PERFORMANCE.md)** - Optimization and benchmarks

## Quick Reference

### Common Commands

```bash
# Wizard (recommended for first-time users)
npx tsx bin/migrate-wizard.ts

# Export from Auth0
npx tsx bin/export-auth0.ts \
  --domain <domain> \
  --client-id <id> \
  --client-secret <secret>

# Transform Clerk export to WorkOS format
npx tsx bin/transform-clerk.ts \
  --clerk-csv clerk-export.csv \
  --output workos-users.csv

# Validate CSV
npx tsx bin/validate-csv.ts --csv users.csv

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

### By Use Case

**Migrating from Auth0**
→ Start with [Wizard Guide](getting-started/WIZARD.md) or [Export Phase](phases/01-EXPORT.md)

**Migrating from Clerk**
→ See [Clerk Migration Guide](guides/CLERK-MIGRATION.md)

**Already have a CSV file**
→ See [Quick Start Guide](getting-started/QUICK-START.md)

**Multi-organization setup**
→ See [Multi-Org Guide](guides/MULTI-ORG.md)

**Large imports (100K+ users)**
→ See [Worker Pool Guide](advanced/WORKER-POOL.md)

**Errors during import**
→ See [Troubleshooting Guide](guides/TROUBLESHOOTING.md)

**Migrating roles & permissions**
→ See [Role Mapping Guide](guides/ROLE-MAPPING.md)

**Password migration**
→ See [Password Migration Guide](guides/PASSWORD-MIGRATION.md)

## Documentation Structure

```
docs/
├── getting-started/       # Quick start guides
│   ├── QUICK-START.md    # Direct command usage
│   └── WIZARD.md         # Wizard walkthrough
│
├── phases/               # Phase-by-phase guides
│   ├── 01-EXPORT.md     # Export from Auth0
│   ├── 02-VALIDATE.md   # Validate CSV
│   ├── 03-MAP.md        # Field mapping
│   ├── 04-ANALYZE.md    # Error analysis
│   └── 05-IMPORT.md     # Import to WorkOS
│
├── guides/               # How-to guides
│   ├── CSV-FORMAT.md    # CSV column reference
│   ├── CLERK-MIGRATION.md # Clerk migration guide
│   ├── MULTI-ORG.md     # Multi-org imports
│   ├── PASSWORD-MIGRATION.md
│   ├── METADATA.md
│   └── TROUBLESHOOTING.md
│
└── advanced/             # Advanced topics
    ├── CHUNKING-RESUMABILITY.md
    ├── WORKER-POOL.md
    ├── PRE-WARMING.md
    └── PERFORMANCE.md
```

## Support

- **Issues**: [GitHub Issues](../../../issues)
- **Questions**: [GitHub Discussions](../../../discussions)
- **Main README**: [../README.md](../README.md)

---

**Quick Links:**
[Wizard](getting-started/WIZARD.md) | [Quick Start](getting-started/QUICK-START.md) | [Import Phase](phases/05-IMPORT.md) | [Troubleshooting](guides/TROUBLESHOOTING.md) | [Multi-Org](guides/MULTI-ORG.md)
