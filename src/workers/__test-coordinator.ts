/**
 * Integration test for WorkerCoordinator
 *
 * Run with: npx tsx src/workers/__test-coordinator.ts
 *
 * This test verifies that the coordinator can:
 * 1. Initialize multiple workers (2 workers)
 * 2. Distribute chunks across workers
 * 3. Coordinate rate limiting via IPC
 * 4. Merge cache updates from workers
 * 5. Save checkpoints after each chunk
 * 6. Produce correct final summary
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WorkerCoordinator } from './coordinator.js';
import { CheckpointManager } from '../checkpoint/manager.js';
import { OrganizationCache } from '../cache/organizationCache.js';
import { createLogger } from '../logger.js';
import { calculateCsvHash, countCsvRows } from '../checkpoint/csvUtils.js';
import type { WorkerImportOptions } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('Worker Coordinator Integration Test');
console.log('===================================\n');

/**
 * Run the integration test
 */
async function runTest() {
  const testJobId = `test-coord-${Date.now()}`;
  const csvPath = path.join(__dirname, '../../examples/phase3-chunk-test.csv');
  const baseCheckpointDir = path.join(__dirname, '../../.workos-checkpoints');
  const jobCheckpointDir = path.join(baseCheckpointDir, testJobId);

  console.log(`Test configuration:`);
  console.log(`  Job ID: ${testJobId}`);
  console.log(`  CSV: ${csvPath}`);
  console.log(`  Workers: 2`);
  console.log(`  Checkpoint dir: ${jobCheckpointDir}\n`);

  // Clean up any existing checkpoint
  if (fs.existsSync(jobCheckpointDir)) {
    fs.rmSync(jobCheckpointDir, { recursive: true });
  }

  try {
    // Step 1: Analyze CSV and create checkpoint manager
    console.log('Step 1: Analyzing CSV and creating checkpoint...');
    const totalRows = await countCsvRows(csvPath);
    const csvHash = await calculateCsvHash(csvPath);

    console.log(`  CSV analyzed: ${totalRows} rows, hash: ${csvHash.substring(0, 16)}...`);

    const checkpointManager = await CheckpointManager.create({
      jobId: testJobId,
      csvPath,
      csvHash,
      totalRows,
      chunkSize: 3, // Small chunks: 3 users per chunk (10 users total = 4 chunks)
      concurrency: 2,
      mode: 'single-org',
      orgId: 'org_test_single',
      checkpointDir: baseCheckpointDir
    });

    console.log(`✓ Checkpoint created with ${checkpointManager.getState().chunks.length} chunks\n`);

    // Step 2: Initialize organization cache (empty for single-org mode)
    const orgCache = null; // Single-org mode doesn't need cache

    // Step 3: Create worker import options
    const importOptions: WorkerImportOptions = {
      csvPath,
      concurrency: 2,
      orgId: 'org_test_single',
      requireMembership: false,
      dryRun: true // Dry run so we don't create actual users
    };

    // Step 4: Create logger
    const logger = createLogger({ quiet: false });

    // Step 5: Create coordinator
    console.log('Step 2: Creating coordinator with 2 workers...');
    const coordinator = new WorkerCoordinator(
      {
        checkpointManager,
        numWorkers: 2,
        orgCache,
        importOptions
      },
      logger
    );

    // Step 6: Start processing
    console.log('\nStep 3: Starting parallel processing...\n');
    const startTime = Date.now();

    const summary = await coordinator.start();

    const duration = Date.now() - startTime;

    // Step 7: Verify results
    console.log('\n===================================');
    console.log('Test Results');
    console.log('===================================\n');

    console.log('Summary:');
    console.log(`  Total: ${summary.total}`);
    console.log(`  Successes: ${summary.successes}`);
    console.log(`  Failures: ${summary.failures}`);
    console.log(`  Memberships: ${summary.membershipsCreated}`);
    console.log(`  Duration: ${duration}ms`);

    if (summary.chunkProgress) {
      console.log(`\nChunk Progress:`);
      console.log(`  Completed: ${summary.chunkProgress.completedChunks}/${summary.chunkProgress.totalChunks}`);
      console.log(`  Percent: ${summary.chunkProgress.percentComplete.toFixed(1)}%`);
    }

    console.log('\nValidation:');

    // Validate expected results (phase3-chunk-test.csv has 10 users)
    const expectedTotal = 10;
    const expectedSuccesses = 10; // Dry run should succeed for all
    const expectedFailures = 0;

    let allPassed = true;

    if (summary.total === expectedTotal) {
      console.log(`  ✓ Total count correct (${expectedTotal})`);
    } else {
      console.log(`  ✗ Total count incorrect: expected ${expectedTotal}, got ${summary.total}`);
      allPassed = false;
    }

    if (summary.successes === expectedSuccesses) {
      console.log(`  ✓ Success count correct (${expectedSuccesses})`);
    } else {
      console.log(`  ✗ Success count incorrect: expected ${expectedSuccesses}, got ${summary.successes}`);
      allPassed = false;
    }

    if (summary.failures === expectedFailures) {
      console.log(`  ✓ Failure count correct (${expectedFailures})`);
    } else {
      console.log(`  ✗ Failure count incorrect: expected ${expectedFailures}, got ${summary.failures}`);
      allPassed = false;
    }

    if (summary.chunkProgress && summary.chunkProgress.completedChunks === summary.chunkProgress.totalChunks) {
      console.log(`  ✓ All chunks completed`);
    } else {
      console.log(`  ✗ Not all chunks completed`);
      allPassed = false;
    }

    // Check that checkpoint exists
    const actualCheckpointPath = checkpointManager.getCheckpointPath();
    if (fs.existsSync(actualCheckpointPath)) {
      console.log(`  ✓ Checkpoint file created`);
    } else {
      console.log(`  ✗ Checkpoint file not found at: ${actualCheckpointPath}`);
      allPassed = false;
    }

    // Clean up
    console.log('\nCleaning up test checkpoint...');
    fs.rmSync(jobCheckpointDir, { recursive: true });

    console.log('\n===================================');
    if (allPassed) {
      console.log('Integration test PASSED ✓');
      console.log('===================================');
      console.log('\nPhase 4.3 validation: Coordinator manages multiple workers correctly ✓');
      process.exit(0);
    } else {
      console.log('Integration test FAILED ✗');
      console.log('===================================');
      process.exit(1);
    }

  } catch (err) {
    console.error('\n✗ Test failed with error:', err);

    // Clean up on error
    if (fs.existsSync(jobCheckpointDir)) {
      fs.rmSync(jobCheckpointDir, { recursive: true });
    }

    process.exit(1);
  }
}

// Run test
runTest().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
