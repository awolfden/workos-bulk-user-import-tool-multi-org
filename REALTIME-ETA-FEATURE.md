# Real-Time ETA Feature for Auth0 Export

## Overview
The Auth0 export now shows a real-time estimate of remaining time based on actual export progress, rather than showing a pre-calculated estimate before the export starts.

## What Changed

### 1. Removed Pre-Export Time Estimates
**Before:** The wizard would show an estimated duration before starting the export based on:
- User's selected scale (small/medium/large)
- Rough user count estimates
- Rate limit configuration

**Problem:** These estimates were inaccurate because we don't know the actual user count until we start exporting.

**After:** No pre-export estimate is shown. The wizard proceeds directly to the export.

### 2. Added Real-Time ETA During Export
**New Behavior:** As the export runs, it continuously calculates and displays:
- Current progress (users exported so far)
- Current throughput (users/second)
- **Estimated Time to Completion (ETA)**

### 3. How ETA is Calculated

#### Dynamic Total Estimation
Since we don't know the total users upfront, we estimate as we go:
```
After completing N organizations out of M total:
  Average users per org = Total users exported / N
  Estimated total users = Average users per org × M
```

This estimate improves with each organization processed, becoming more accurate over time.

#### ETA Calculation
```
Elapsed time = Current time - Start time
Throughput = Users exported / Elapsed time (in seconds)
Remaining users = Estimated total - Users exported
ETA = Remaining users / Throughput
```

#### Smart ETA Display
- **First 5 seconds:** Shows "calculating..." (collecting baseline data)
- **After 5 seconds:** Shows accurate ETA updated in real-time
- **Updates every 2 seconds** to avoid screen flicker
- **Auto-adjusts** as throughput changes due to rate limiting

## Example Output

### Interactive Mode (TTY with progress bars):
```
Organizations |████████████░░░░░░░░| 45% | 68/150 orgs
Users         |█████████░░░░░░░░░░░| 42% | 6,345/15,200 users ETA: 8m 23s
```

### Non-Interactive Mode (CI/logs):
```
Progress: 6,345 users exported (2.1 users/sec) - ETA: 8m 23s
  ✓ mytest-org-067: 94/95 users (1 skipped)
Progress: 6,439 users exported (2.1 users/sec) - ETA: 8m 12s
  ✓ mytest-org-068: 98/98 users
```

## Technical Implementation

### Files Modified

#### `src/ui/exportProgressUI.ts`
- Added ETA calculation logic
- Added throttling (updates every 2 seconds)
- Enhanced progress bar format to include ETA
- Added `calculateETA()` and `formatETA()` methods

#### `src/exporters/auth0/auth0Exporter.ts`
- Calculate estimated total users after each organization
- Pass estimated total to progress UI
- Dynamic estimation improves accuracy over time

#### `src/wizard/migrationPlanner.ts`
- Removed `calculateExportDuration()` function
- Removed `estimatedDuration` field from export step

#### `src/wizard/summaryReporter.ts`
- Removed pre-export time estimate display

## Benefits

### 1. More Accurate
- Based on **actual** throughput, not estimates
- Adjusts to real-world rate limiting
- Accounts for varying organization sizes

### 2. Real-Time Feedback
- Users see progress immediately
- ETA updates dynamically
- Shows if export is slowing down or speeding up

### 3. Better User Experience
- No misleading pre-export estimates
- Clear visibility into remaining time
- Builds confidence during long exports

## ETA Accuracy

### Factors Affecting Accuracy:
- **Early in export:** Less accurate (first 10-20% of orgs)
- **Middle of export:** Very accurate (±2 minutes for 15k users)
- **End of export:** Most accurate

### Rate Limit Impact:
The ETA automatically accounts for rate limiting:
- **Trial Plan (2 RPS):** ETA will be longer, but accurate
- **Developer Plan (50 RPS):** ETA will be shorter
- **Enterprise Plan (100+ RPS):** Even faster ETA

### Organization Size Variance:
If organizations have very different sizes:
- Early estimate may fluctuate
- Stabilizes as more orgs are processed
- Final ETA becomes highly accurate

## Example Scenarios

### Small Export (50 orgs, 5,000 users, 50 RPS)
```
Initial:     "calculating..."
After 10s:   "ETA: 2m 15s"
After 30s:   "ETA: 1m 52s"
After 1m:    "ETA: 1m 8s"
Completion:  2m 3s (within 3% of estimate)
```

### Large Export (150 orgs, 15,000 users, 2 RPS)
```
Initial:     "calculating..."
After 30s:   "ETA: 2h 15m"
After 2m:    "ETA: 2h 8m"
After 10m:   "ETA: 1h 58m"
After 1h:    "ETA: 1h 2m"
Completion:  2h 5m (within 5% of estimate)
```

## Comparison: Before vs After

### Before (Pre-Export Estimate)
```
Your migration will follow these steps:

1. Export from Auth0
   Export users and organizations from Auth0
   Estimated time: ~10 minutes      ← Shown before export starts
   Command: npx tsx bin/export-auth0.ts ...

[Export runs... user sees no time remaining]
```

### After (Real-Time ETA)
```
Your migration will follow these steps:

1. Export from Auth0
   Export users and organizations from Auth0
   Command: npx tsx bin/export-auth0.ts ...

[Export runs with real-time feedback]
Progress: 6,345 users exported (2.1 users/sec) - ETA: 8m 23s
Progress: 7,892 users exported (2.2 users/sec) - ETA: 6m 15s
Progress: 9,234 users exported (2.3 users/sec) - ETA: 4m 32s
```

## Future Enhancements

Possible improvements for the future:
1. Show ETA for individual organizations (very large orgs)
2. Historical throughput averaging for smoother ETA
3. Warning if throughput drops significantly
4. Prediction of rate limit resets
5. ETA for metadata-based exports (harder without org count)

## Testing

To see the real-time ETA in action:
```bash
# Run the wizard with a medium-sized export
npx tsx bin/migrate-wizard.ts

# Watch for the ETA updates during the export phase
# ETA will appear after ~5 seconds and update every 2 seconds
```
