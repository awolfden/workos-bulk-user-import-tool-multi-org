# Auth0 Password Migration Guide

Complete guide for migrating Auth0 users with their password hashes to WorkOS.

## Overview

Auth0 does not provide password hashes through their Management API for security reasons. To migrate users with their existing passwords (without forcing password resets), you need to:

1. Request a password export from Auth0 support
2. Export users using the Auth0 exporter
3. Merge password hashes into the CSV
4. Import to WorkOS

## Prerequisites

### Required

- ✅ Auth0 **paid plan** (password exports not available on free plans)
- ✅ Auth0 tenant with database users (not social/enterprise connections)
- ✅ Auth0 support ticket access

### Recommended

- ✅ Test environment for validation before production migration
- ✅ Database backup before migration
- ✅ Communication plan for users (in case issues arise)

## Step-by-Step Process

### Step 1: Request Password Export from Auth0

**Timeline**: ~1 week processing time

1. **Open Auth0 Support Ticket**
   - Go to [Auth0 Support Center](https://support.auth0.com)
   - Select "Create Ticket"
   - Category: "Bulk Operations" or "User Management"

2. **Ticket Content Template**:
   ```
   Subject: Password Hash Export Request for Migration

   Hello Auth0 Support,

   We are migrating from Auth0 to another identity provider and need to
   export password hashes for our database users to avoid forcing password resets.

   Tenant: [YOUR_TENANT_NAME].auth0.com
   Connection: [YOUR_DATABASE_CONNECTION_NAME]
   Estimated user count: [NUMBER]

   Please provide the password hash export in NDJSON format.

   Thank you!
   ```

3. **Wait for Response**
   - Auth0 typically responds within 1-2 business days
   - Processing can take up to 1 week
   - They will provide a secure download link

4. **Download the File**
   - File format: `.ndjson` or `.json.gz` (compressed)
   - Extract if compressed: `gunzip auth0-passwords.json.gz`

### Step 2: Export Users from Auth0

While waiting for the password export, you can export your users:

```bash
npx tsx bin/export-auth0.ts \
  --domain your-tenant.auth0.com \
  --client-id YOUR_CLIENT_ID \
  --client-secret YOUR_CLIENT_SECRET \
  --output auth0-users.csv
```

This creates a CSV with all user data EXCEPT passwords (which come separately).

### Step 3: Merge Password Hashes

Once you receive the password export from Auth0, merge it with your CSV:

```bash
npx tsx bin/merge-auth0-passwords.ts \
  --csv auth0-users.csv \
  --passwords auth0-passwords.ndjson \
  --output auth0-users-with-passwords.csv
```

**What this does**:
- Reads the NDJSON password file
- Matches users by email address
- Adds `password_hash` and `password_hash_type` columns to CSV
- Detects hash algorithm automatically (typically bcrypt)

### Step 4: Validate the Merged CSV

Check the output to ensure passwords were merged:

```bash
# Check first few rows
head -3 auth0-users-with-passwords.csv

# Count users with passwords
grep -c '\$2b\$' auth0-users-with-passwords.csv
```

Expected output:
- Each row should have a password_hash starting with `$2b$` or `$2a$`
- password_hash_type should be `bcrypt`

### Step 5: Import to WorkOS

```bash
npx tsx bin/import-users.ts \
  --csv auth0-users-with-passwords.csv \
  --concurrency 10 \
  --errors-out import-errors.jsonl
```

**Result**: Users can log in with their existing passwords - no reset required! 🎉

## Auth0 Password Export Format

### NDJSON Structure

Auth0 provides password exports as newline-delimited JSON. Each line is a complete JSON object:

```json
{"_id":{"$oid":"60425dc43519d90068f82973"},"email":"user@example.com","email_verified":false,"passwordHash":"$2b$10$Z6hUTEEeoJXN5/AmSm/4.eZ75RYgFVriQM9LPhNEC7kbAbS/VAaJ2","password_set_date":{"$date":"2021-03-05T16:35:16.775Z"},"tenant":"your-tenant","connection":"Username-Password-Authentication"}
```

### Field Descriptions

| Field | Description | Example |
|-------|-------------|---------|
| `_id.$oid` | Auth0 internal user ID (MongoDB format) | `"60425dc43519d90068f82973"` |
| `email` | User email address | `"user@example.com"` |
| `email_verified` | Email verification status | `true` or `false` |
| `passwordHash` | Bcrypt password hash | `"$2b$10$..."` |
| `password_set_date.$date` | When password was last set | `"2021-03-05T16:35:16.775Z"` |
| `tenant` | Auth0 tenant name | `"your-tenant"` |
| `connection` | Database connection name | `"Username-Password-Authentication"` |

### Hash Algorithm Details

Auth0 uses **bcrypt** with these parameters:
- Algorithm variant: `$2a$` or `$2b$`
- Cost factor (salt rounds): **10**
- Compatible with WorkOS bcrypt import

**Example hash breakdown**:
```
$2b$10$Z6hUTEEeoJXN5/AmSm/4.eZ75RYgFVriQM9LPhNEC7kbAbS/VAaJ2
 │   │  │                        └─ Hash (31 chars)
 │   │  └─ Salt (22 chars)
 │   └─ Cost factor (10 rounds = 2^10 iterations)
 └─ Algorithm variant ($2b$ = bcrypt)
```

## Troubleshooting

### Issue: No password export file received

**Possible causes**:
- Request still processing (can take up to 1 week)
- Free Auth0 plan (password exports require paid plan)
- Users are from social/enterprise connections (no database passwords)

**Solution**:
- Follow up on support ticket after 3-5 business days
- Verify you're on a paid plan
- Check that users are in a database connection

### Issue: Merge tool reports "No password found"

**Symptoms**:
```
✓ Loaded 1000 password hashes
✓ Processed 1500 rows
✓ Added passwords for 1000 users
✓ No password found for 500 users
```

**Possible causes**:
1. Email addresses don't match between CSV and NDJSON
2. Some users are from social connections (no database password)
3. Users created after password export was generated

**Solution**:
```bash
# Check for email mismatches (case sensitivity)
# The tool normalizes emails to lowercase, but check source data

# Identify users without passwords
grep -E ',,' auth0-users-with-passwords.csv | cut -d',' -f1

# Decision: Import with passwords for matched users
# Users without passwords will need to reset on first login
```

### Issue: Import fails with password hash errors

**Symptoms**:
```
Record #5 failed: Invalid password hash format
```

**Possible causes**:
- Non-bcrypt hashes (MD5, SHA, etc.)
- Corrupted hash data
- Incorrect algorithm detection

**Solution**:
1. Check hash format in CSV:
   ```bash
   head -5 auth0-users-with-passwords.csv | cut -d',' -f5,6
   ```

2. Verify hashes start with `$2a$` or `$2b$`

3. If using non-bcrypt hashes, contact WorkOS support for custom import

### Issue: Users can't log in after migration

**Symptoms**: Users report "Invalid credentials" with correct password

**Possible causes**:
- Password hash not imported correctly
- Algorithm mismatch
- Hash corruption during transfer

**Solution**:
1. Verify user's password_hash in WorkOS dashboard
2. Check import logs for that specific user
3. As temporary workaround, trigger password reset for affected users
4. For widespread issues, re-export and re-merge password data

## Security Considerations

### Password Hash Transport

**During migration**:
- ✅ Password hashes are encrypted at rest in Auth0 export
- ✅ HTTPS used for Auth0 support file downloads
- ✅ WorkOS API uses TLS for import
- ⚠️ Local files contain sensitive data

**Best practices**:
1. Store password export files securely
2. Delete local copies after successful import
3. Use encrypted file systems for temporary storage
4. Limit access to migration files (restrict permissions)

### Post-Migration

After successful migration:

1. **Verify Import**: Test login with sample users
2. **Monitor**: Watch for authentication errors
3. **Cleanup**: Delete local password export files
4. **Document**: Record which users were migrated with passwords
5. **Communication**: Notify users migration is complete

### Users Without Passwords

Some users may not have passwords in the export:
- Social connection users (Google, GitHub, etc.)
- Enterprise SSO users (SAML, OIDC)
- Users who never set a password

**Handling**:
- These users will need to set/reset passwords after migration
- Or maintain social/SSO connections in WorkOS

## Migration Strategies

### Strategy 1: Big Bang Migration (Recommended)

Migrate all users at once with passwords:

**Pros**:
- ✅ Minimal user disruption
- ✅ No password resets required
- ✅ Single cutover window

**Cons**:
- ⚠️ Requires careful planning
- ⚠️ All-or-nothing approach

**Steps**:
1. Export users + passwords
2. Test import in staging
3. Schedule maintenance window
4. Import to production
5. Switch application to WorkOS
6. Monitor for issues

### Strategy 2: Phased Migration

Migrate users in batches:

**Pros**:
- ✅ Lower risk
- ✅ Can validate each batch

**Cons**:
- ⚠️ More complex
- ⚠️ Some users may need password reset if password changed between batches

**Steps**:
1. Export all users
2. Request password export (one-time)
3. Import batch 1 with passwords
4. Validate
5. Import batch 2, 3, etc.

**Note**: Password export is a snapshot. Users who change passwords after the export will need to reset.

### Strategy 3: Lazy Migration (No Passwords)

Import users without passwords, migrate passwords on-demand:

**Pros**:
- ✅ Simpler process
- ✅ No password export needed

**Cons**:
- ⚠️ All users must reset passwords
- ⚠️ Higher support burden

**Steps**:
1. Export users without passwords
2. Import to WorkOS
3. Users reset passwords on first login

## Tools Reference

### Export Users
```bash
npx tsx bin/export-auth0.ts \
  --domain tenant.auth0.com \
  --client-id CLIENT_ID \
  --client-secret CLIENT_SECRET \
  --output users.csv
```

### Merge Passwords
```bash
npx tsx bin/merge-auth0-passwords.ts \
  --csv users.csv \
  --passwords passwords.ndjson \
  --output users-with-passwords.csv
```

**Options**:
- `--quiet`: Suppress progress output
- All three arguments are required

### Import to WorkOS
```bash
npx tsx bin/import-users.ts \
  --csv users-with-passwords.csv \
  --concurrency 10 \
  --errors-out errors.jsonl
```

## FAQ

### Q: Can I export passwords via Auth0 Management API?

**A**: No. Auth0 does not provide password hashes via API for security reasons. You must request a manual export from Auth0 support.

### Q: How long does Auth0 take to provide password exports?

**A**: Typically 1-7 business days. Large tenants (100K+ users) may take longer.

### Q: What if I can't get password exports?

**A**: You can migrate without passwords. Users will need to reset passwords on first login. This is actually more secure but requires user action.

### Q: Do social connection users have password hashes?

**A**: No. Users who log in via Google, GitHub, etc. don't have database passwords. Only users in Auth0 database connections have password hashes.

### Q: Can I migrate passwords from other providers (Okta, Cognito)?

**A**: This tool is specific to Auth0's NDJSON format. Other providers have different export formats. Contact WorkOS support for guidance on other providers.

### Q: What if passwords changed between export and import?

**A**: Password exports are snapshots. Users who changed passwords after the export will need to reset passwords in WorkOS.

### Q: Are password hashes secure during migration?

**A**: Yes. Bcrypt hashes are one-way cryptographic hashes. Even if exposed, they cannot be reversed to obtain plain-text passwords. However, follow security best practices for handling export files.

## Additional Resources

- [Auth0 Bulk User Exports Documentation](https://auth0.com/docs/manage-users/user-migration/bulk-user-exports)
- [WorkOS User Management API](https://workos.com/docs/user-management)
- [Bcrypt Password Hashing](https://en.wikipedia.org/wiki/Bcrypt)
- [Auth0 Support Center](https://support.auth0.com)

## Summary Checklist

Before starting migration:
- [ ] Confirmed Auth0 is on paid plan
- [ ] Opened support ticket for password export
- [ ] Tested export process in non-production environment
- [ ] Reviewed security considerations
- [ ] Planned cutover window
- [ ] Prepared user communication

During migration:
- [ ] Exported users from Auth0
- [ ] Received password export from Auth0 support
- [ ] Merged passwords into CSV
- [ ] Validated merged data
- [ ] Tested import in staging
- [ ] Imported to production
- [ ] Verified user logins work

After migration:
- [ ] Deleted local password export files
- [ ] Monitored authentication errors
- [ ] Documented any issues
- [ ] Communicated completion to users
- [ ] Decommissioned Auth0 tenant (when ready)
