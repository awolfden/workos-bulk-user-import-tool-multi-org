# Migration Wizard Guide

Interactive step-by-step tool for migrating users from Auth0 to WorkOS.

## Overview

The Migration Wizard guides you through the complete migration process:

1. **Export** - Download users from Auth0
2. **Validate** - Check CSV and auto-fix issues
3. **Plan** - Review migration plan
4. **Import** - Execute migration to WorkOS
5. **Analyze** - Review errors (if any)
6. **Retry** - Retry failed imports (if needed)

## Quick Start

```bash
WORKOS_SECRET_KEY=sk_test_123 npx tsx bin/migrate-wizard.ts
```

The wizard will ask you questions and guide you through each step.

## Prerequisites

Before starting:

1. **WorkOS API Key**: Set `WORKOS_SECRET_KEY` environment variable
2. **Node.js 18+**: Required for execution
3. **Auth0 Credentials** (if migrating from Auth0): M2M application credentials

The wizard will check prerequisites and help you set them up if missing.

## What the Wizard Does

### 1. Asks Questions About Your Migration

**Migration Source:**
- Auth0 (guided export)
- Custom CSV (you have a file ready)

**Auth0 Credentials** (if Auth0):
- Domain (e.g., `dev-example.us.auth0.com`)
- Client ID
- Client Secret
- Include metadata? (Yes/No)

**Password Hashes** (if Auth0):
- Do you have an Auth0 password export file?
- Path to NDJSON file (if yes)

**Import Mode:**
- Single organization (all users to one org)
- Multiple organizations (CSV has org columns)

**Organization** (if single-org):
- Organization ID (e.g., `org_abc123`)
- Or Organization external ID
- Or Organization name (creates if missing)

**Scale & Performance:**
- How many users? (<10K, 10K-100K, >100K)
- Enable checkpointing? (recommended for large imports)
- Enable workers for parallel processing? (recommended for >100K)
- Number of workers? (4 recommended)

**Validation:**
- Validate CSV before importing? (recommended)
- Auto-fix common issues? (recommended)

**Error Handling:**
- Log errors to file? (recommended)
- Error log path (default: `errors.jsonl`)

### 2. Shows Migration Plan

After answering questions, you'll see a complete plan:

```
════════════════════════════════════════════════════
MIGRATION PLAN
════════════════════════════════════════════════════

Source:      auth0
Import Mode: single-org

Your migration will follow these steps:

1. Export from Auth0
   Export users and organizations from Auth0
   Command: npx tsx bin/export-auth0.ts --domain ...

2. Validate CSV
   Validate CSV data and auto-fix common issues
   Command: npx tsx bin/validate-csv.ts --csv ...

3. Execute Import
   Import users to WorkOS
   Command: npx tsx bin/import-users.ts --csv ...

💡 Recommendations:
  • Checkpoint directory: .workos-checkpoints/
  • You can resume with --resume flag

════════════════════════════════════════════════════

? Ready to start the migration? › (Y/n)
```

### 3. Executes Migration

Once you confirm, the wizard runs each step automatically:

```
Step 1/5: Export from Auth0
════════════════════════════════════════════════════
Running: npx tsx bin/export-auth0.ts ...

[====================] 100% | 1,234 users exported

✓ Export from Auth0 completed

Step 2/5: Validate CSV
════════════════════════════════════════════════════
...
```

### 4. Shows Final Summary

```
════════════════════════════════════════════════════
MIGRATION COMPLETE
════════════════════════════════════════════════════

✓ Migration completed successfully!

Steps:
  Total:     5
  Completed: 5
  Failed:    0

Users:
  Total:     1,234
  Success:   1,234
  Failed:    0

Duration: 4m 32s

Generated Files:
  • auth0-export.csv
  • users-validated.csv
  • validation-report.json
  • migration-summary.json

✓ All users successfully migrated!
```

## CLI Options

```bash
# Interactive mode (default)
npx tsx bin/migrate-wizard.ts

# Dry-run (show plan without executing)
npx tsx bin/migrate-wizard.ts --dry-run

# Non-interactive (skip confirmation)
npx tsx bin/migrate-wizard.ts --yes

# Quiet mode
npx tsx bin/migrate-wizard.ts --quiet

# Pre-fill options for automation
npx tsx bin/migrate-wizard.ts \
  --source auth0 \
  --org-id org_abc123 \
  --yes
```

## Generated Files

| File | Description |
|------|-------------|
| `auth0-export.csv` | Exported users from Auth0 |
| `users-validated.csv` | Validated and fixed CSV |
| `validation-report.json` | Validation results |
| `errors.jsonl` | Import errors (if any) |
| `error-analysis.json` | Error analysis report |
| `retry.csv` | Retryable errors CSV |
| `migration-summary.json` | Complete migration summary |
| `.env` | Saved credentials |

## Common Scenarios

### Scenario 1: Small Auth0 Migration (< 10K users)

**Answers:**
- Source: Auth0
- Import mode: Single organization
- Org ID: `org_abc123`
- Scale: Less than 10,000
- Checkpointing: No
- Workers: No

**Result:** Simple, fast migration in 1-2 minutes

### Scenario 2: Large Multi-Org Migration (> 100K users)

**Answers:**
- Source: Auth0
- Import mode: Multiple organizations
- Scale: More than 100,000
- Checkpointing: Yes
- Workers: Yes (4 workers)

**Result:** Parallel processing with checkpoints, ~15-20 minutes for 100K users

### Scenario 3: Custom CSV Import

**Answers:**
- Source: Custom CSV
- CSV path: `/path/to/users.csv`
- Import mode: (depends on your CSV)

**Result:** Skips export step, goes straight to validation and import

## Resuming Interrupted Migrations

If the wizard is interrupted (Ctrl+C, crash, etc.):

```bash
# Resume from checkpoint (if checkpointing was enabled)
npx tsx bin/migrate-wizard.ts --resume
```

The wizard will:
- Detect existing checkpoint
- Show completed steps
- Continue from where it stopped

## When to Use the Wizard vs. Direct Tools

### Use the Wizard When:
✅ First time migrating from Auth0
✅ Want guided step-by-step process
✅ Prefer interactive prompts
✅ Don't want to remember command syntax

### Use Direct Tools When:
✅ Need fine-grained control over steps
✅ Automating in scripts/CI
✅ Want to customize each command
✅ Already familiar with the workflow

See [Quick Start Guide](QUICK-START.md) for direct tool usage.

## Troubleshooting

### "WORKOS_SECRET_KEY environment variable not set"

Set your WorkOS API key:

```bash
export WORKOS_SECRET_KEY=sk_test_123
# Or add to .env file
echo "WORKOS_SECRET_KEY=sk_test_123" > .env
```

### "Auth0 domain should end with .auth0.com"

Use full domain:
- ✓ Correct: `dev-example.us.auth0.com`
- ✗ Wrong: `dev-example`

### "Organization ID should start with org_"

Use full WorkOS organization ID:
- ✓ Correct: `org_abc123xyz`
- ✗ Wrong: `abc123xyz`

### Migration interrupted

If you enabled checkpointing:
```bash
npx tsx bin/migrate-wizard.ts --resume
```

If no checkpoint:
```bash
npx tsx bin/migrate-wizard.ts  # Start over
```

## Password Migration

Auth0 doesn't provide password hashes via the Management API. You must request a password export from Auth0 support.

**How to get Auth0 password hashes:**
1. Contact Auth0 support
2. Request a password export
3. They provide an NDJSON file with bcrypt hashes
4. Provide the path to the wizard

**Without password hashes:**
- Users imported without passwords
- Must reset password on first login
- Less seamless migration experience

**With password hashes:**
- Users can log in immediately
- Seamless migration
- Better user experience

See [Password Migration Guide](../guides/PASSWORD-MIGRATION.md) for details.

## Next Steps

After wizard completes:

- **Success**: Users are migrated to WorkOS!
- **Errors**: Review `error-analysis.json` and run retry
- **Learn more**: See [Import Phase](../phases/05-IMPORT.md)
- **Advanced**: See [Worker Pool](../advanced/WORKER-POOL.md) for large-scale optimization

## Related Documentation

- [Quick Start Guide](QUICK-START.md) - Direct tool usage
- [Phase 1: Export](../phases/01-EXPORT.md) - Auth0 export details
- [Phase 2: Validate](../phases/02-VALIDATE.md) - Validation rules
- [Phase 5: Import](../phases/05-IMPORT.md) - Import options
- [Password Migration Guide](../guides/PASSWORD-MIGRATION.md) - Password formats
