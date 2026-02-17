# Quick Start: End-to-End Export Testing

## One-Command Test (Recommended First)

```bash
# Create .env file with your Auth0 credentials
cat > .env << EOF
AUTH0_DOMAIN=your-tenant.auth0.com
AUTH0_CLIENT_ID=your-client-id
AUTH0_CLIENT_SECRET=your-client-secret
EOF

# Run complete test cycle (1000 users)
# Creates data → Exports → Tests resume → Cleans up
./scripts/run-e2e-test.sh
```

## Manual Testing (Step by Step)

### Step 1: Create Test Data

**Small test (100 users - 2 minutes)**:
```bash
npx tsx scripts/create-auth0-test-data.ts \
  --domain your-tenant.auth0.com \
  --client-id <id> \
  --client-secret <secret> \
  --orgs 5 \
  --users-per-org 20 \
  --prefix test-small
```

**Large test (20K users - 20 minutes)**:
```bash
npx tsx scripts/create-auth0-test-data.ts \
  --domain your-tenant.auth0.com \
  --client-id <id> \
  --client-secret <secret> \
  --orgs 20 \
  --users-per-org 1000 \
  --prefix test-large
```

### Step 2: Test Export

**Without checkpointing**:
```bash
npx tsx bin/export-auth0.ts \
  --domain your-tenant.auth0.com \
  --client-id <id> \
  --client-secret <secret> \
  --output test-export.csv
```

**With checkpointing** (for large exports):
```bash
npx tsx bin/export-auth0.ts \
  --domain your-tenant.auth0.com \
  --client-id <id> \
  --client-secret <secret> \
  --output test-export.csv \
  --job-id test-export-$(date +%s)
```

### Step 3: Test Resume (Optional)

**Start export, then kill it (Ctrl+C) after a few orgs complete**

**Resume from checkpoint**:
```bash
npx tsx bin/export-auth0.ts \
  --domain your-tenant.auth0.com \
  --client-id <id> \
  --client-secret <secret> \
  --output test-export.csv \
  --resume <job-id-from-step2>
```

### Step 4: Validate Export

```bash
# Check row count
wc -l test-export.csv

# Validate CSV format
npx tsx bin/validate-csv.ts --csv test-export.csv

# Preview first 10 rows
head -10 test-export.csv | column -t -s','
```

### Step 5: Clean Up

```bash
npx tsx scripts/cleanup-auth0-test-data.ts \
  --domain your-tenant.auth0.com \
  --client-id <id> \
  --client-secret <secret> \
  --prefix test-small \
  --yes

# Remove checkpoint and CSV
rm -rf .workos-checkpoints/test-*
rm -f test-*.csv
```

## What to Look For

### ✅ Progress Bars (Interactive Terminal)
```
Organizations |████████████░░░░░░░░| 60% | 12/20 orgs
Users         |██████████████████░░| 90% | 18000/20000 users
```

### ✅ Organization Logging
```
ℹ Found 20 organizations
ℹ Created checkpoint: test-export-1234567890

  ✓ test-org-000: 1000/1000 users
  ✓ test-org-001: 998/1002 users (4 skipped)
  ✗ test-org-002: Rate limit exceeded
```

### ✅ Resume Status
```
ℹ Resuming from checkpoint: test-export-1234567890
  Already completed: 10 organizations
  Remaining: 10 organizations

  ↷ Skipping test-org-000 (already completed)
  ↷ Skipping test-org-001 (already completed)
  ✓ test-org-002: 1000/1000 users
```

### ✅ Final Summary
```
════════════════════════════════════════════════════════════
  EXPORT SUMMARY
════════════════════════════════════════════════════════════

Status:           ✓ Success
Organizations:    20/20
Users exported:   19,850
Users skipped:    150
Duration:         8m 45s
Throughput:       37.8 users/sec

════════════════════════════════════════════════════════════
```

## Common Issues

### Issue: "Connection failed"
**Solution**: Check credentials, domain, and Management API scopes

### Issue: "Rate limit exceeded"
**Solution**: Lower `--user-fetch-concurrency` or `--rate-limit`
```bash
--user-fetch-concurrency 5 --rate-limit 25
```

### Issue: Progress bars not showing
**Cause**: Non-TTY environment or `--quiet` flag
**Solution**: Remove `--quiet` flag, run in interactive terminal

### Issue: "Credentials do not match checkpoint"
**Solution**: Use same credentials as original export, or start new export with different `--job-id`

## Quick Performance Test

Compare sequential vs parallel user fetching:

```bash
# Sequential (slow)
time npx tsx bin/export-auth0.ts \
  --domain your-tenant.auth0.com \
  --client-id <id> \
  --client-secret <secret> \
  --output test-sequential.csv \
  --user-fetch-concurrency 1

# Parallel (fast)
time npx tsx bin/export-auth0.ts \
  --domain your-tenant.auth0.com \
  --client-id <id> \
  --client-secret <secret> \
  --output test-parallel.csv \
  --user-fetch-concurrency 10
```

**Expected**: Parallel should be 5-8x faster

## Resource Usage

**Auth0 Free Tier Limits**:
- Max users: 25,000
- Rate limit: ~50 requests/sec
- Test budget: ~21,000 users (leaves 4K buffer)

**Recommended Test Sizes**:
- Quick validation: 100 users (2 min)
- Progress bar testing: 1,000 users (5 min)
- Full feature testing: 10,000-20,000 users (15-30 min)

## Next Steps After Testing

1. ✅ Export validates successfully
2. ✅ Progress bars display correctly
3. ✅ Checkpoint/resume works
4. ✅ Performance meets expectations

Then:
```bash
# Document any issues found
# Export production data (if ready)
# Integrate with CI/CD
```

## Support

If tests fail:
1. Check Auth0 Management API scopes
2. Verify rate limits aren't exceeded
3. Check checkpoint files for state
4. Review errors.jsonl if import tested
5. Report issues with logs
