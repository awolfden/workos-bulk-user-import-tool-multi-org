# Migration Wizard

Interactive guided migration tool for migrating users from Auth0, Okta, or Cognito to WorkOS.

## Overview

The Migration Wizard is a step-by-step interactive CLI that guides you through the complete migration process:

1. **Export** - Export users from your identity provider
2. **Validate** - Validate CSV data and auto-fix common issues
3. **Plan** - Generate migration plan with estimates
4. **Import** - Execute the import to WorkOS
5. **Analyze** - Analyze errors and generate retry CSV
6. **Retry** - Retry failed imports

## Quick Start

Run the wizard:

```bash
npx tsx bin/migrate-wizard.ts
```

The wizard will:

- Check prerequisites (WorkOS API key, Node.js version)
- Ask you questions about your migration
- Generate a migration plan
- Execute each step with progress updates
- Provide a final summary with next steps

## Prerequisites

Before running the wizard, ensure you have:

1. **WorkOS API Key** - Set `WORKOS_SECRET_KEY` environment variable
2. **Node.js 18+** - Required for TypeScript execution
3. **Provider Credentials** - Auth0 M2M application credentials (if migrating from Auth0)

The wizard will check these prerequisites and guide you if anything is missing.

## Interactive Questions

The wizard asks the following questions:

### 1. Migration Source

```
? What are you migrating from?
  > Auth0
    Okta (coming soon)
    Cognito (coming soon)
    Custom CSV (I already have a CSV file)
```

**Auth0**: Exports users directly from Auth0 Management API
**Custom CSV**: Use an existing CSV file you've prepared

### 2. Auth0 Credentials (if Auth0 selected)

```
? Do you have Auth0 M2M application credentials? › No

Let me guide you through setting up Auth0 credentials:

1. Go to your Auth0 Dashboard → Applications → Applications
2. Click "Create Application" → "Machine to Machine"
3. Name it "WorkOS Migration Tool"
4. Select the Auth0 Management API
5. Grant these permissions:
   ✓ read:users
   ✓ read:organizations
   ✓ read:organization_members
6. Copy the Domain, Client ID, and Client Secret

? Auth0 Domain (e.g., dev-example.us.auth0.com): ›
? Client ID: ›
? Client Secret: ›
? Include user metadata in export? › Yes
```

Credentials are saved to `.env` file for future use.

### 3. Password Hashes (if Auth0 selected)

```
🔐 Password Hashes
Auth0 does not provide password hashes via the Management API.
You must request a password export from Auth0 support.
This provides an NDJSON file with user emails and bcrypt hashes.

? Do you have an Auth0 password export file (NDJSON)? › No

⚠️  Users will be imported without password hashes

Users will need to reset their passwords on first login.
```

If you have password hashes:

```
? Do you have an Auth0 password export file (NDJSON)? › Yes
? Path to Auth0 password NDJSON file: › auth0-passwords.ndjson
✓ Password file configured
```

**How to get Auth0 password hashes:**

1. Contact Auth0 support and request a password export
2. They will provide an NDJSON file containing bcrypt hashes
3. Save this file and provide the path to the wizard
4. The wizard will automatically merge passwords into your export

**Note**: Password hashes are essential for seamless migration. Without them, users must reset passwords.

### 4. Import Mode

```
? How do you want to import users?
  > Single organization (all users go to one org)
    Multiple organizations (CSV has org columns)
```

**Single-org**: All users added to the same WorkOS organization
**Multi-org**: CSV contains `org_id`, `org_external_id`, or `org_name` columns

### 5. Organization Specification (single-org mode)

```
? How do you want to specify the organization?
  > Organization ID (org_xxx)
    Organization external ID
    Organization name (will create if missing)

? Enter organization ID: › org_abc123
```

### 6. Scale & Performance

```
? Approximately how many users are you migrating?
  > Less than 10,000
    10,000 - 100,000
    More than 100,000

? Enable checkpointing for resumability? › Yes (recommended for your scale)
```

For large migrations (>100K users):

```
? Enable multi-worker processing for faster imports? › Yes (recommended)
? How many workers? › 4
```

### 7. Data Validation

```
? Validate CSV before importing? › Yes (recommended)
? Automatically fix common issues (whitespace, formatting)? › Yes
```

### 8. Error Handling

```
? Log errors to file for retry? › Yes (recommended)
? Error log file path: › errors.jsonl
```

## Migration Plan

After answering questions, the wizard shows a migration plan:

```
════════════════════════════════════════════════════
MIGRATION PLAN
════════════════════════════════════════════════════

Source:      auth0
Import Mode: single-org

Your migration will follow these steps:

1. Export from Auth0
   Export users and organizations from Auth0
   Command: npx tsx bin/export-auth0.ts --domain dev-example.us.auth0.com ...

2. Merge Password Hashes
   Merge Auth0 password hashes into CSV export
   (only runs if you provided password file)
   Command: npx tsx bin/merge-auth0-passwords.ts --csv auth0-export.csv --passwords auth0-passwords.ndjson --output auth0-export-with-passwords.csv

3. Validate CSV
   Validate CSV data and auto-fix common issues
   Command: npx tsx bin/validate-csv.ts --csv auth0-export-with-passwords.csv ...

4. Plan Import
   Generate import plan with estimates
   Command: npx tsx bin/orchestrate-migration.ts --csv users-validated.csv --plan ...

5. Execute Import
   Import users to WorkOS
   Command: npx tsx bin/orchestrate-migration.ts --csv users-validated.csv ...

6. Analyze Errors
   Analyze import errors and generate retry CSV
   (optional - will only run if needed)
   Command: npx tsx bin/analyze-errors.ts --errors errors.jsonl ...

7. Retry Failed Imports
   Retry failed imports from error analysis
   (optional - will only run if needed)
   Command: npx tsx bin/orchestrate-migration.ts --csv retry.csv ...

💡 Recommendations:
  • Consider including metadata for complete user profiles
  • Checkpoint directory: .workos-checkpoints/
  • You can resume this migration with --resume flag

════════════════════════════════════════════════════

? Ready to start the migration? › (Y/n)
```

## Execution

Once confirmed, the wizard executes each step:

```
════════════════════════════════════════════════════
EXECUTING MIGRATION
════════════════════════════════════════════════════

Step 1/6: Export from Auth0
════════════════════════════════════════════════════
Export users and organizations from Auth0

Running: npx tsx bin/export-auth0.ts --domain dev-example.us.auth0.com ...

[====================] 100% | 1234 users exported

✓ Export from Auth0 completed

Step 2/6: Validate CSV
════════════════════════════════════════════════════
...
```

Progress is shown for each step with real-time updates.

## Summary

At the end, the wizard displays a complete summary:

```
════════════════════════════════════════════════════
MIGRATION COMPLETE
════════════════════════════════════════════════════

✓ Migration completed successfully!

Steps:
  Total:     6
  Completed: 6
  Failed:    0
  Skipped:   0

Users:
  Total:     1,234
  Success:   1,234
  Failed:    0

Duration:
  4m 32s

Generated Files:
  • auth0-export.csv
  • users-validated.csv
  • validation-report.json
  • migration-summary.json

Migration summary saved to: migration-summary.json

✓ All users successfully migrated!
```

## CLI Options

### Basic Options

```bash
# Interactive mode (default)
npx tsx bin/migrate-wizard.ts

# Dry-run (show plan without executing)
npx tsx bin/migrate-wizard.ts --dry-run

# Non-interactive (skip confirmation)
npx tsx bin/migrate-wizard.ts --yes

# Quiet mode (suppress progress)
npx tsx bin/migrate-wizard.ts --quiet
```

### Pre-filled Options

For non-interactive use, pre-fill answers via CLI flags:

```bash
npx tsx bin/migrate-wizard.ts \
  --source auth0 \
  --org-id org_abc123 \
  --auth0-domain dev-example.us.auth0.com \
  --yes
```

## Generated Files

The wizard generates the following files:

| File                     | Description                  |
| ------------------------ | ---------------------------- |
| `auth0-export.csv`       | Exported users from Auth0    |
| `users-validated.csv`    | Validated and fixed CSV      |
| `validation-report.json` | Validation results           |
| `errors.jsonl`           | Import errors (one per line) |
| `error-analysis.json`    | Error analysis report        |
| `retry.csv`              | Retryable errors CSV         |
| `migration-summary.json` | Complete migration summary   |
| `.env`                   | Saved credentials            |

## Error Handling

If the migration encounters errors:

1. **Non-critical errors** (validation warnings, optional step failures):

   - Wizard continues to next step
   - Warnings shown in summary

2. **Critical errors** (export failed, import configuration invalid):

   - Wizard stops immediately
   - Error details displayed
   - Logs written to `migration-summary.json`

3. **Import failures** (some users failed to import):
   - Wizard continues to error analysis
   - Generates retry CSV automatically
   - Offers to retry failed imports

## Resuming Migrations

If a migration is interrupted:

```bash
# Resume from checkpoint (if checkpointing was enabled)
npx tsx bin/migrate-wizard.ts --resume
```

The wizard will:

- Detect existing checkpoint
- Show progress so far
- Continue from where it left off

## Examples

### Example 1: Small Auth0 Migration

```bash
npx tsx bin/migrate-wizard.ts
```

Wizard prompts:

- Source: Auth0
- Import mode: Single organization
- Org ID: org_abc123
- Scale: Less than 10,000
- Checkpointing: No
- Validation: Yes
- Error logging: Yes

Result: 1,234 users migrated in ~1 minute

### Example 2: Large Multi-Org Migration

```bash
npx tsx bin/migrate-wizard.ts
```

Wizard prompts:

- Source: Auth0
- Import mode: Multiple organizations
- Scale: More than 100,000
- Checkpointing: Yes
- Workers: 4
- Validation: Yes
- Error logging: Yes

Result: 125,000 users migrated in ~15 minutes

### Example 3: Custom CSV Import

```bash
npx tsx bin/migrate-wizard.ts
```

Wizard prompts:

- Source: Custom CSV
- CSV path: /path/to/users.csv
- Import mode: Single organization
- Org ID: org_abc123
- Validation: Yes

Result: Uses existing CSV file, skips export step

### Example 4: Dry-Run Planning

```bash
npx tsx bin/migrate-wizard.ts --dry-run
```

Shows complete migration plan without executing. Useful for:

- Reviewing steps before migration
- Estimating duration
- Checking configuration
- Generating commands for manual execution

### Example 5: Non-Interactive CI/CD

```bash
npx tsx bin/migrate-wizard.ts \
  --source auth0 \
  --org-id org_abc123 \
  --auth0-domain dev-example.us.auth0.com \
  --yes \
  --quiet
```

Suitable for automated migrations in CI/CD pipelines.

## Comparison with Direct Tools

### Using Wizard

**Pros:**

- Guided step-by-step process
- Automatic error handling and retry
- Single command for end-to-end migration
- Saves configuration for future runs
- Interactive prompts prevent mistakes

**Cons:**

- Less control over individual steps
- Interactive mode not suitable for scripts
- Fixed workflow (can't skip arbitrary steps)

### Using Direct Tools

**Pros:**

- Fine-grained control over each step
- Can execute steps independently
- Scriptable and automatable
- Can customize command arguments

**Cons:**

- Must remember correct command sequence
- Manual error handling
- More opportunities for mistakes
- Need to track intermediate files

**Recommendation:**

- Use **wizard** for manual migrations and learning the workflow
- Use **direct tools** for automation, custom workflows, and advanced use cases

## Troubleshooting

### Issue: "WORKOS_SECRET_KEY environment variable not set"

**Solution:**

```bash
export WORKOS_SECRET_KEY=sk_...
# Or add to .env file
echo "WORKOS_SECRET_KEY=sk_..." >> .env
```

### Issue: "Auth0 domain should end with .auth0.com"

**Solution:**
Use the full Auth0 domain including `.auth0.com`:

- ✓ Correct: `dev-example.us.auth0.com`
- ✗ Wrong: `dev-example`

### Issue: "Organization ID should start with org\_"

**Solution:**
Use the full WorkOS organization ID:

- ✓ Correct: `org_abc123xyz`
- ✗ Wrong: `abc123xyz`

### Issue: Migration interrupted (Ctrl+C)

**Solution:**
If checkpointing was enabled, resume:

```bash
npx tsx bin/migrate-wizard.ts --resume
```

If no checkpoint, restart from beginning:

```bash
npx tsx bin/migrate-wizard.ts
```

### Issue: "Command exited with code 1"

**Cause:** One of the migration steps failed

**Solution:**

1. Check `migration-summary.json` for error details
2. Review failed step output
3. Fix the issue (e.g., invalid CSV, missing org)
4. Re-run the wizard (it will skip completed steps if using checkpoints)

## Advanced Usage

### Custom Concurrency and Chunk Size

The wizard automatically sets these based on scale, but you can customize by editing the generated commands in the plan.

### Skip Validation

Not recommended, but possible by answering "No" to validation prompt.

### Use Existing Export

Choose "Custom CSV" as source and provide path to your existing export.

### Multi-Org with Custom Mappings

For complex multi-org scenarios, use direct tools:

1. Export: `npx tsx bin/export-auth0.ts`
2. Map fields: `npx tsx bin/map-fields.ts`
3. Validate: `npx tsx bin/validate-csv.ts`
4. Import: `npx tsx bin/orchestrate-migration.ts`

## Related Documentation

- [Phase 1: Auth0 Exporter](PHASE1-EXPORT.md) - Auth0 export details
- [Phase 2: Data Validator](PHASE2-VALIDATE.md) - Validation rules
- [Phase 3: Field Mapper](PHASE3-MAP.md) - Field transformation
- [Phase 4: Error Analyzer](PHASE4-ANALYZE.md) - Error analysis
- [Phase 5: Import Orchestrator](PHASE5-ORCHESTRATE.md) - Import orchestration

## Support

For issues or questions:

- Review error messages and troubleshooting section
- Check migration-summary.json for details
- Use --dry-run to test configuration
- Run individual tools directly for debugging
