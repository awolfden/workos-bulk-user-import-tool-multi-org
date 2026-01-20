# End-to-End Export Testing Plan

## Overview

Complete testing workflow using Auth0 free trial (up to 25K users). Tests all export features including progress bars, checkpointing, resume, and parallel user fetching.

## Prerequisites

- Auth0 free trial account (12 days remaining)
- No billing information entered
- Management API app created with required scopes
- Node.js 18+ installed

## Test Scenarios

### Scenario 1: Small Scale Test (Baseline)
**Purpose**: Validate basic functionality
**Dataset**: 5 orgs × 20 users = 100 users
**Duration**: ~2 minutes

### Scenario 2: Medium Scale Test (Performance)
**Purpose**: Test progress bars and throughput
**Dataset**: 10 orgs × 100 users = 1,000 users
**Duration**: ~5 minutes

### Scenario 3: Large Scale Test (Full Feature)
**Purpose**: Test checkpointing, resume, and parallel fetching
**Dataset**: 20 orgs × 1,000 users = 20,000 users
**Duration**: ~15-20 minutes

## Setup Instructions

### 1. Set Environment Variables

```bash
export AUTH0_DOMAIN="your-tenant.auth0.com"
export AUTH0_CLIENT_ID="your-client-id"
export AUTH0_CLIENT_SECRET="your-client-secret"
```

Or create `.env` file:
```bash
AUTH0_DOMAIN=your-tenant.auth0.com
AUTH0_CLIENT_ID=your-client-id
AUTH0_CLIENT_SECRET=your-client-secret
```

### 2. Verify Auth0 Connection

```bash
npx tsx bin/export-auth0.ts \
  --domain $AUTH0_DOMAIN \
  --client-id $AUTH0_CLIENT_ID \
  --client-secret $AUTH0_CLIENT_SECRET \
  --output /tmp/test.csv \
  --dry-run
```

## Test Execution

### Test 1: Small Scale Baseline

**Step 1: Create test data**
```bash
npx tsx scripts/create-auth0-test-data.ts \
  --domain $AUTH0_DOMAIN \
  --client-id $AUTH0_CLIENT_ID \
  --client-secret $AUTH0_CLIENT_SECRET \
  --orgs 5 \
  --users-per-org 20 \
  --prefix test-small
```

**Expected**: Creates 5 orgs and 100 users (~2 min)

**Step 2: Export without checkpointing**
```bash
npx tsx bin/export-auth0.ts \
  --domain $AUTH0_DOMAIN \
  --client-id $AUTH0_CLIENT_ID \
  --client-secret $AUTH0_CLIENT_SECRET \
  --output test-small-export.csv
```

**Verify**:
- ✅ Progress bars display correctly
- ✅ All 5 organizations exported
- ✅ 100 users in CSV
- ✅ Summary shows correct stats
- ✅ CSV validates with workos-validate-csv

**Step 3: Clean up**
```bash
npx tsx scripts/cleanup-auth0-test-data.ts \
  --domain $AUTH0_DOMAIN \
  --client-id $AUTH0_CLIENT_ID \
  --client-secret $AUTH0_CLIENT_SECRET \
  --prefix test-small \
  --yes
```

---

### Test 2: Medium Scale Performance

**Step 1: Create test data**
```bash
npx tsx scripts/create-auth0-test-data.ts \
  --domain $AUTH0_DOMAIN \
  --client-id $AUTH0_CLIENT_ID \
  --client-secret $AUTH0_CLIENT_SECRET \
  --orgs 10 \
  --users-per-org 100 \
  --prefix test-medium
```

**Expected**: Creates 10 orgs and 1,000 users (~5 min)

**Step 2: Export with performance monitoring**
```bash
time npx tsx bin/export-auth0.ts \
  --domain $AUTH0_DOMAIN \
  --client-id $AUTH0_CLIENT_ID \
  --client-secret $AUTH0_CLIENT_SECRET \
  --output test-medium-export.csv \
  --user-fetch-concurrency 10 \
  --rate-limit 50
```

**Verify**:
- ✅ Progress bars update smoothly
- ✅ Organization progress: 0/10 → 10/10
- ✅ User progress increments by 100s
- ✅ Throughput ~100-200 users/sec
- ✅ No rate limit errors
- ✅ Duration < 1 minute

**Step 3: Test different concurrency levels**
```bash
# Low concurrency
npx tsx bin/export-auth0.ts \
  --domain $AUTH0_DOMAIN \
  --client-id $AUTH0_CLIENT_ID \
  --client-secret $AUTH0_CLIENT_SECRET \
  --output test-medium-low.csv \
  --user-fetch-concurrency 2

# High concurrency
npx tsx bin/export-auth0.ts \
  --domain $AUTH0_DOMAIN \
  --client-id $AUTH0_CLIENT_ID \
  --client-secret $AUTH0_CLIENT_SECRET \
  --output test-medium-high.csv \
  --user-fetch-concurrency 20
```

**Compare throughput**: High should be 5-8x faster than low

**Step 4: Clean up**
```bash
npx tsx scripts/cleanup-auth0-test-data.ts \
  --domain $AUTH0_DOMAIN \
  --client-id $AUTH0_CLIENT_ID \
  --client-secret $AUTH0_CLIENT_SECRET \
  --prefix test-medium \
  --yes
```

---

### Test 3: Large Scale with Checkpointing

**Step 1: Create test data**
```bash
npx tsx scripts/create-auth0-test-data.ts \
  --domain $AUTH0_DOMAIN \
  --client-id $AUTH0_CLIENT_ID \
  --client-secret $AUTH0_CLIENT_SECRET \
  --orgs 20 \
  --users-per-org 1000 \
  --prefix test-large
```

**Expected**: Creates 20 orgs and 20,000 users (~15-20 min)

**Step 2: Export with checkpointing**
```bash
npx tsx bin/export-auth0.ts \
  --domain $AUTH0_DOMAIN \
  --client-id $AUTH0_CLIENT_ID \
  --client-secret $AUTH0_CLIENT_SECRET \
  --output test-large-export.csv \
  --job-id test-large-20k \
  --user-fetch-concurrency 10
```

**Verify**:
- ✅ Checkpoint created message displays
- ✅ Progress bars show 0/20 → 20/20 organizations
- ✅ User progress increments in real-time
- ✅ Each org completion logged
- ✅ Checkpoint file exists: `.workos-checkpoints/test-large-20k/export-checkpoint.json`

**Step 3: Interrupt and resume**

Start export, then **kill it after ~10 orgs** (Ctrl+C after 5-10 minutes):
```bash
npx tsx bin/export-auth0.ts \
  --domain $AUTH0_DOMAIN \
  --client-id $AUTH0_CLIENT_ID \
  --client-secret $AUTH0_CLIENT_SECRET \
  --output test-large-export.csv \
  --job-id test-large-20k \
  --user-fetch-concurrency 10
```

After killing, check checkpoint:
```bash
cat .workos-checkpoints/test-large-20k/export-checkpoint.json | jq '.summary'
```

**Resume from checkpoint**:
```bash
npx tsx bin/export-auth0.ts \
  --domain $AUTH0_DOMAIN \
  --client-id $AUTH0_CLIENT_ID \
  --client-secret $AUTH0_CLIENT_SECRET \
  --output test-large-export.csv \
  --resume test-large-20k
```

**Verify**:
- ✅ "Resuming from checkpoint" message displays
- ✅ Shows "Already completed: X organizations"
- ✅ Shows "Remaining: Y organizations"
- ✅ Skips completed organizations (logs "↷ Skipping...")
- ✅ Only processes remaining organizations
- ✅ CSV appends to existing file
- ✅ Final user count = 20,000

**Step 4: Validate CSV output**
```bash
wc -l test-large-export.csv  # Should be 20,001 (header + 20K users)

npx tsx bin/validate-csv.ts \
  --csv test-large-export.csv
```

**Verify**:
- ✅ 20,000 rows (+ 1 header)
- ✅ All required columns present
- ✅ No validation errors
- ✅ All emails unique

**Step 5: Test credential validation on resume**

Try to resume with wrong credentials (should fail):
```bash
npx tsx bin/export-auth0.ts \
  --domain different-tenant.auth0.com \
  --client-id $AUTH0_CLIENT_ID \
  --client-secret $AUTH0_CLIENT_SECRET \
  --output test-large-export.csv \
  --resume test-large-20k
```

**Verify**:
- ✅ Error: "Credentials do not match checkpoint"

**Step 6: Clean up**
```bash
npx tsx scripts/cleanup-auth0-test-data.ts \
  --domain $AUTH0_DOMAIN \
  --client-id $AUTH0_CLIENT_ID \
  --client-secret $AUTH0_CLIENT_SECRET \
  --prefix test-large \
  --yes
```

---

### Test 4: Edge Cases

**Test 4a: Organization with no users**

Create empty org manually in Auth0 dashboard, then export.

**Verify**: No errors, org skipped gracefully

**Test 4b: Users without email**

Not possible in Auth0 (email required), skip this test.

**Test 4c: Rate limiting**

Force rate limit errors:
```bash
npx tsx bin/export-auth0.ts \
  --domain $AUTH0_DOMAIN \
  --client-id $AUTH0_CLIENT_ID \
  --client-secret $AUTH0_CLIENT_SECRET \
  --output test-rate.csv \
  --rate-limit 1000 \
  --user-fetch-concurrency 50
```

**Verify**:
- ✅ Rate limiter automatically backs off
- ✅ Export completes without 429 errors
- ✅ Throughput self-regulates

**Test 4d: Organization failure**

Manually delete one organization mid-export (requires timing).

**Verify**:
- ✅ Failed org logged as error
- ✅ Export continues with other orgs
- ✅ Checkpoint marks org as "failed"

---

## Test Matrix

| Test | Orgs | Users/Org | Total | Checkpoint | Resume | Duration |
|------|------|-----------|-------|------------|--------|----------|
| Small | 5 | 20 | 100 | No | No | ~30s |
| Medium | 10 | 100 | 1,000 | No | No | ~1m |
| Large | 20 | 1,000 | 20,000 | Yes | Yes | ~8-12m |

**Total Auth0 Users Used**: ~21,100 (well under 25K limit)

## Success Criteria

### Functionality
- ✅ All organizations exported
- ✅ All users exported
- ✅ CSV format valid
- ✅ Checkpoint created when requested
- ✅ Resume skips completed orgs
- ✅ Credential validation on resume

### Progress UI
- ✅ Organization progress bar displays
- ✅ User progress bar displays (if estimate provided)
- ✅ Real-time updates during export
- ✅ Color-coded logging works
- ✅ Summary displays with correct stats

### Performance
- ✅ Throughput: 100-200 users/sec (with concurrency 10)
- ✅ No memory leaks during large export
- ✅ Parallel user fetching 5-8x faster than sequential

### Error Handling
- ✅ Rate limit errors handled gracefully
- ✅ Failed organizations don't crash export
- ✅ Invalid credentials rejected
- ✅ Checkpoint prevents data loss

## Cleanup

After all tests complete:

```bash
# Remove all test data
npx tsx scripts/cleanup-auth0-test-data.ts \
  --domain $AUTH0_DOMAIN \
  --client-id $AUTH0_CLIENT_ID \
  --client-secret $AUTH0_CLIENT_SECRET \
  --prefix test-small \
  --yes

npx tsx scripts/cleanup-auth0-test-data.ts \
  --domain $AUTH0_DOMAIN \
  --client-id $AUTH0_CLIENT_ID \
  --client-secret $AUTH0_CLIENT_SECRET \
  --prefix test-medium \
  --yes

npx tsx scripts/cleanup-auth0-test-data.ts \
  --domain $AUTH0_DOMAIN \
  --client-id $AUTH0_CLIENT_ID \
  --client-secret $AUTH0_CLIENT_SECRET \
  --prefix test-large \
  --yes

# Remove checkpoint directories
rm -rf .workos-checkpoints/test-*

# Remove exported CSVs
rm -f test-*.csv
```

## Timeline

Total test execution time (with setup/cleanup):
- Setup: 5 minutes
- Test 1: 10 minutes
- Test 2: 20 minutes
- Test 3: 40 minutes
- Test 4: 10 minutes
- Cleanup: 10 minutes

**Total: ~95 minutes (1.5 hours)**

## Notes

- Run tests during off-peak hours to avoid Auth0 rate limits
- Keep terminal window open during long exports to see progress bars
- Save checkpoint files for analysis
- Document any unexpected behavior
- Check Auth0 dashboard for user/org count verification
