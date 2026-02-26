# Migrating from Firebase

Step-by-step guide for migrating users from Firebase Authentication to WorkOS.

## Overview

The Firebase migration transforms a Firebase JSON user export into WorkOS-compatible format, then validates and imports the users. Firebase uses a JSON-based export via the Firebase CLI, and its passwords are hashed with a modified scrypt algorithm that WorkOS supports natively.

**Migration flow:**

1. **Export** — Export your users via the Firebase CLI
2. **Transform** — Convert Firebase JSON fields to WorkOS format (`transform-firebase`)
3. **Validate** — Check the transformed CSV for errors (`validate-csv`)
4. **Import** — Migrate users into WorkOS (`import-users` / `orchestrate-migration`)

You can run these steps manually via CLI or let the wizard handle them automatically.

For additional context, see the [WorkOS Firebase migration guide](https://workos.com/docs/migrate/firebase).

## Prerequisites

Before starting:

1. **Firebase JSON export** — Exported via the Firebase CLI (see [Obtaining Your Firebase Export](#obtaining-your-firebase-export))
2. **Firebase password hash parameters** — Obtained from the Firebase Console (see [Obtaining Password Hash Parameters](#obtaining-password-hash-parameters))
3. **WorkOS API key** — Set `WORKOS_SECRET_KEY` environment variable
4. **Node.js 18+** — Required for execution
5. **Organization mapping CSV** (optional) — Maps Firebase users to WorkOS organizations (see [Organization Mapping CSV](#organization-mapping-csv))

```bash
export WORKOS_SECRET_KEY=sk_test_your_key_here
```

## Obtaining Your Firebase Export

Firebase provides a CLI-based user export:

1. Install the Firebase CLI:

```bash
npm install -g firebase-tools
```

2. Log in to Firebase:

```bash
firebase login
```

3. Export your users as JSON:

```bash
firebase auth:export users.json --format=JSON --project=<project-id>
```

Replace `<project-id>` with your Firebase project ID.

The exported JSON contains an array of user objects with fields like `localId`, `email`, `displayName`, `passwordHash`, `salt`, and more.

For full details on the Firebase CLI auth export, see the [Firebase CLI Auth documentation](https://firebase.google.com/docs/cli/auth).

## Obtaining Password Hash Parameters

Firebase uses a modified scrypt algorithm for password hashing. To migrate passwords, you need your project's hash parameters.

1. Go to the [Firebase Console](https://console.firebase.google.com)
2. Select your project
3. Navigate to **Authentication** > **Users**
4. Click the **&#8942;** (three-dot menu) in the top right
5. Select **Password Hash Parameters**

Record the following values:

| Parameter | Description | Example |
|-----------|-------------|---------|
| `base64_signer_key` | The scrypt signer key (base64-encoded) | `jxspr8Ki0RYycVU8zykb...` |
| `base64_salt_separator` | Salt separator (base64-encoded) | `Bw==` |
| `rounds` | Number of scrypt rounds | `8` |
| `mem_cost` | Memory cost parameter | `14` |

These parameters are **project-level** — they are the same for all users in your Firebase project.

For more information on Firebase's scrypt implementation, see the [Firebase Scrypt documentation](https://firebaseopensource.com/projects/firebase/scrypt/).

## Organization Mapping CSV

If your Firebase users belong to organizations, you need a separate CSV that maps each user to their organization. Firebase does not include org membership in its user export, so you must provide this mapping yourself.

The mapping CSV must have a `firebase_uid` column plus one or more organization columns.

### Format Variants

**1. `org_id` — Direct WorkOS org ID (org already exists in WorkOS)**

```csv
firebase_uid,org_id
abc123def456,org_abc123
ghi789jkl012,org_def456
```

**2. `org_external_id` + `org_name` — Auto-create orgs during import**

```csv
firebase_uid,org_external_id,org_name
abc123def456,acme-corp,Acme Corporation
ghi789jkl012,acme-corp,Acme Corporation
mno345pqr678,beta-inc,Beta Inc
```

The importer will look up each org by `org_external_id`. If the org doesn't exist, it auto-creates one with the given `org_name` and `org_external_id`.

**3. `org_external_id` only — Lookup by external ID (org must exist)**

```csv
firebase_uid,org_external_id
abc123def456,acme-corp
ghi789jkl012,beta-inc
```

The importer looks up the org by external ID. If it doesn't exist, the import for that user fails.

**4. `org_name` only — Lookup or create by name**

```csv
firebase_uid,org_name
abc123def456,Acme Corporation
ghi789jkl012,Beta Inc
```

The importer looks up the org by name. If it doesn't exist, it auto-creates one.

### Priority Rules

When multiple org columns are present, `org_id` takes priority:

- If `org_id` is provided, it is used directly — `org_external_id` and `org_name` are ignored
- If `org_id` is absent, `org_external_id` and `org_name` are passed through to the import step

An example is included at `examples/firebase/firebase-org-mapping.csv`.

## Role Mapping CSV (Optional)

If your users have roles or permissions to migrate, you can provide a role mapping CSV that assigns roles during import.

The role mapping CSV uses `firebase_uid` as the join key (same as the org mapping):

```csv
firebase_uid,role_slug
abc123def456,admin
abc123def456,editor
ghi789jkl012,viewer
mno345pqr678,org-admin
```

Each row is a single user-role pair. Users with multiple roles have multiple rows.

### Using Role Mapping with Transform

Pass `--role-mapping` to the transform step. Role slugs are merged into the output CSV as a `role_slugs` column:

```bash
npx tsx bin/transform-firebase.ts \
  --firebase-json users.json \
  --org-mapping firebase-org-mapping.csv \
  --role-mapping user-role-mapping.csv \
  --signer-key "jxspr8Ki0RYycVU8zykb..." \
  --output workos-users.csv
```

The import step then reads role slugs from the transformed CSV and assigns them during membership creation.

### Role Definitions

If your roles don't already exist in WorkOS, process a role definitions CSV first:

```bash
npx tsx bin/process-role-definitions.ts \
  --definitions role-definitions.csv
```

See [Role Mapping Guide](ROLE-MAPPING.md) for the full workflow.

An example is included at `examples/firebase/firebase-role-mapping.csv`.

## Option A: Wizard (Recommended)

The wizard automates the full transform → validate → import pipeline.

### Launch

```bash
WORKOS_SECRET_KEY=sk_test_123 npx tsx bin/migrate-wizard.ts
```

### Wizard Prompts

1. **What are you migrating from?** — Select **Firebase**
2. **Path to your Firebase JSON export file** — Enter the path to your exported JSON
3. **Firebase password hash parameters** — Enter your signer key, salt separator, rounds, and memory cost
4. **Display name splitting strategy** — Select how to split `displayName` into first/last name
5. **Include disabled users?** — Yes/No
6. **Do you have a user-to-organization mapping CSV?** — Yes/No
   - If yes: enter the path to your org mapping CSV
   - Import mode auto-sets to **multi-org** when an org mapping is provided
7. If no org mapping: **How do you want to import users?** — Single org or multi-org
8. **Scale & performance** — User count, checkpointing, workers
9. **Validation** — Validate CSV, auto-fix issues
10. **Error handling** — Log errors to file
11. **Dry run** — Test before live import

### What the Wizard Does Automatically

1. **Transform Firebase Export** — Runs `transform-firebase` to convert your Firebase JSON to WorkOS format (outputs `firebase-transformed.csv`)
2. **Validate CSV** — Runs `validate-csv` with auto-fix (outputs `users-validated.csv`)
3. **Plan Import** — Shows estimated duration and configuration
4. **Dry Run** (if enabled) — Tests import without creating users
5. **Execute Import** — Imports users into WorkOS
6. **Analyze Errors** (if any) — Generates retry CSV for failed records

## Option B: CLI (Step-by-Step)

### Step 1: Transform Firebase Export

**Without org mapping:**

```bash
npx tsx bin/transform-firebase.ts \
  --firebase-json users.json \
  --signer-key "jxspr8Ki0RYycVU8zykb..." \
  --salt-separator "Bw==" \
  --rounds 8 \
  --mem-cost 14 \
  --output workos-users.csv
```

**With org mapping and all flags:**

```bash
npx tsx bin/transform-firebase.ts \
  --firebase-json users.json \
  --output workos-users.csv \
  --signer-key "jxspr8Ki0RYycVU8zykb..." \
  --salt-separator "Bw==" \
  --rounds 8 \
  --mem-cost 14 \
  --name-split first-space \
  --include-disabled \
  --org-mapping firebase-org-mapping.csv \
  --role-mapping user-role-mapping.csv \
  --skipped-users firebase-skipped-users.jsonl \
  --quiet
```

**All flags:**

| Flag | Required | Description |
|------|----------|-------------|
| `--firebase-json <path>` | Yes | Path to Firebase JSON export |
| `--output <path>` | Yes | Output path for WorkOS CSV |
| `--signer-key <key>` | No | Firebase scrypt signer key (base64) |
| `--salt-separator <sep>` | No | Salt separator (default: `Bw==`) |
| `--rounds <n>` | No | Scrypt rounds (default: `8`) |
| `--mem-cost <n>` | No | Memory cost parameter (default: `14`) |
| `--name-split <strategy>` | No | Name splitting strategy (default: `first-space`) |
| `--include-disabled` | No | Include disabled users in the output |
| `--org-mapping <path>` | No | Path to organization mapping CSV |
| `--role-mapping <path>` | No | Path to role mapping CSV |
| `--skipped-users <path>` | No | Path for skipped user records (default: `firebase-skipped-users.jsonl`) |
| `--quiet` | No | Suppress output messages |

The transform step produces a summary showing total users, transformed count, skipped count, password stats, name splitting stats, and org mapping stats.

### Step 2: Validate CSV

```bash
npx tsx bin/validate-csv.ts \
  --csv workos-users.csv \
  --auto-fix \
  --fixed-csv users-validated.csv \
  --report validation-report.json
```

### Step 3: Import Users

**Simple import:**

```bash
npx tsx bin/import-users.ts --csv users-validated.csv
```

**Multi-org import with workers:**

```bash
npx tsx bin/import-users.ts \
  --csv users-validated.csv \
  --job-id firebase-migration \
  --workers 4
```

**Dry run first:**

```bash
npx tsx bin/import-users.ts --csv users-validated.csv --dry-run
```

## Password Handling

Firebase uses a **modified scrypt** algorithm (firebase-scrypt) that is distinct from standard scrypt. WorkOS supports the firebase-scrypt hash type natively, so passwords can be migrated without requiring users to reset on first login.

### How It Works

The transformer encodes each user's password hash in [PHC format](https://github.com/P-H-C/phc-string-format) with the `firebase-scrypt` identifier:

```
$firebase-scrypt$hash=<b64hash>$salt=<b64salt>$sk=<b64signerKey>$ss=<b64saltSep>$r=<rounds>$m=<memCost>
```

| Component | Source |
|-----------|--------|
| `hash` | User's `passwordHash` from the Firebase export (base64) |
| `salt` | User's `salt` from the Firebase export (base64) |
| `sk` | Project-level `base64_signer_key` from Firebase Console |
| `ss` | Project-level `base64_salt_separator` from Firebase Console |
| `r` | Project-level `rounds` from Firebase Console |
| `m` | Project-level `mem_cost` from Firebase Console |

### When Hash Parameters Are Not Provided

If you do not supply the `--signer-key` flag, password hashes are **omitted** from the output. Users will need to reset their password on first login to WorkOS. A warning is logged to alert you.

The transformation summary shows how many users had passwords migrated vs. skipped. Check the `firebase-skipped-users.jsonl` file for details on individual skipped records.

For more details, see the [WorkOS Firebase migration guide](https://workos.com/docs/migrate/firebase).

## Display Name Handling

Firebase stores a single `displayName` field rather than separate first and last name fields. The transformer splits this into `first_name` and `last_name` using a configurable strategy.

### Splitting Strategies

| Strategy | Input | first_name | last_name |
|----------|-------|------------|-----------|
| `first-space` (default) | `"John Doe"` | `John` | `Doe` |
| `first-space` | `"Mary Jane Watson"` | `Mary` | `Jane Watson` |
| `last-space` | `"Mary Jane Watson"` | `Mary Jane` | `Watson` |
| `first-name-only` | `"John Doe"` | `John Doe` | *(empty)* |

- **`first-space`** — Splits at the first space. Everything before is `first_name`, everything after is `last_name`. Best for Western-style names.
- **`last-space`** — Splits at the last space. Everything before is `first_name`, everything after is `last_name`. Better for names with multiple given names.
- **`first-name-only`** — Uses the entire `displayName` as `first_name` and leaves `last_name` empty. Safest when name structure is unpredictable.

**Recommendation:** Use `first-space` for Western-style names. Use `first-name-only` if you're unsure about name structure or want to avoid incorrect splitting.

## Field Mapping Reference

| Firebase Field | WorkOS Field | Notes |
|----------------|-------------|-------|
| `localId` | `external_id` | Firebase UID preserved as external ID |
| `email` | `email` | Required — users without an email are skipped |
| `emailVerified` | `email_verified` | Boolean |
| `displayName` | `first_name`, `last_name` | Split using configurable strategy (see [Display Name Handling](#display-name-handling)) |
| `passwordHash` + `salt` | `password_hash` | PHC format with firebase-scrypt (see [Password Handling](#password-handling)) |
| — | `password_hash_type` | Set to `firebase-scrypt` when applicable |

## Metadata

Extra Firebase fields that don't have a direct WorkOS equivalent are stored in the `metadata` JSON column:

| Metadata Key | Source Field |
|-------------|-------------|
| `firebase_uid` | `localId` (always included for cross-referencing) |
| `phone_number` | `phoneNumber` |
| `photo_url` | `photoUrl` |
| `custom_attributes` | `customAttributes` (parsed from JSON string) |
| `provider_info` | `providerUserInfo` |
| `mfa_info` | `mfaInfo` |
| `created_at` | `createdAt` (converted to ISO 8601) |
| `last_signed_in_at` | `lastSignedInAt` (converted to ISO 8601) |

Only non-empty fields are included in the metadata JSON.

## Authentication Method Migration

Firebase supports multiple authentication methods. Here's how each maps to WorkOS:

| Firebase Method | Migration Path |
|----------------|---------------|
| **Email/Password** | Migrated via firebase-scrypt hash — users keep their existing password |
| **Social OAuth** (Google, Facebook, etc.) | Configure the same OAuth credentials in WorkOS |
| **Phone Auth** | Phone number stored in metadata; configure phone-based auth in WorkOS |
| **Email Link / Passwordless** | Use WorkOS Magic Auth |
| **OIDC / SAML** | Configure the same identity providers in WorkOS |

For setup instructions on each authentication method, see the [WorkOS Firebase migration guide](https://workos.com/docs/migrate/firebase).

## Troubleshooting

### "Firebase JSON file not found"

Verify the path to your Firebase export JSON is correct:

```bash
ls -la users.json
```

### "Invalid JSON format"

The Firebase export file is not valid JSON. Re-export using the Firebase CLI:

```bash
firebase auth:export users.json --format=JSON --project=<project-id>
```

Ensure you specify `--format=JSON` (not `--format=CSV`).

### "Missing password hash parameters" warning

You did not provide `--signer-key` during the transform step. Password hashes will be omitted from the output, and users will need to reset their password on first login. To include passwords, re-run the transform with your project's hash parameters (see [Obtaining Password Hash Parameters](#obtaining-password-hash-parameters)).

### Users missing from output

Check the transformation summary and `firebase-skipped-users.jsonl` for users that were skipped. Common reasons:

- **No email address** — Users without an email are skipped (e.g., phone-only users)
- **Disabled accounts** — Disabled users are excluded by default. Use `--include-disabled` to include them.

### "Org mapping not applied"

Ensure your org mapping CSV has a `firebase_uid` column that matches the `localId` field in the Firebase export. The match is exact, so values like `abc123def456` must match between both files.

### Import fails with "organization not found"

If using `org_external_id` without `org_name`, the organization must already exist in WorkOS. Either:
- Create the organization in WorkOS first, or
- Add an `org_name` column to your mapping CSV so the org is auto-created during import

## Related Documentation

- [Firebase CLI Auth Export](https://firebase.google.com/docs/cli/auth) — Firebase CLI documentation for auth export
- [Firebase Admin SDK](https://firebase.google.com/docs/auth/admin/manage-users) — Managing Firebase users programmatically
- [WorkOS Firebase Migration](https://workos.com/docs/migrate/firebase) — WorkOS documentation for Firebase migration
- [Wizard Guide](../getting-started/WIZARD.md) — Interactive migration walkthrough
- [CSV Format Reference](CSV-FORMAT.md) — WorkOS CSV column reference
- [Multi-Organization Imports](MULTI-ORG.md) — Multi-org import details
- [Password Migration](PASSWORD-MIGRATION.md) — Password hash formats
- [Role Mapping Guide](ROLE-MAPPING.md) — Role mapping workflow
