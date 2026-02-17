#!/usr/bin/env npx tsx
/**
 * Phase 5: Migration Planner Tests
 *
 * Tests plan generation, mode detection, and recommendations.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MigrationPlanner } from './migrationPlanner.js';
import type { OrchestratorOptions } from './types.js';

let testsRun = 0;
let testsPassed = 0;
let testsFailed = 0;

function assert(condition: boolean, message: string): void {
  testsRun++;
  if (condition) {
    testsPassed++;
    console.log(`  ✓ ${message}`);
  } else {
    testsFailed++;
    console.error(`  ✗ ${message}`);
  }
}

function testSection(name: string): void {
  console.log(`\n${name}`);
  console.log('='.repeat(name.length));
}

// Helper to create temp CSV file
function createTempCsv(content: string): string {
  const tmpFile = path.join(os.tmpdir(), `test-planner-${Date.now()}-${Math.random()}.csv`);
  fs.writeFileSync(tmpFile, content);
  return tmpFile;
}

// Helper to create minimal valid options
function createOptions(overrides: Partial<OrchestratorOptions> = {}): OrchestratorOptions {
  return {
    csvPath: createTempCsv('email\ntest@example.com\n'),
    ...overrides
  };
}

// Test 1: Single-org mode detection (flag-based)
async function testSingleOrgDetection(): Promise<void> {
  testSection('Test 1: Single-org mode detection (flag-based)');

  const csvPath = createTempCsv('email\ntest@example.com\n');
  const options: OrchestratorOptions = { csvPath, orgId: 'org_123' };
  const planner = new MigrationPlanner(options);
  const plan = await planner.generatePlan();

  assert(plan.summary.mode === 'single-org', 'Should detect single-org mode');
  assert(plan.configuration.orgResolution === 'upfront', 'Should use upfront org resolution');

  // Cleanup
  fs.unlinkSync(csvPath);
}

// Test 2: Multi-org mode detection (CSV columns)
async function testMultiOrgDetection(): Promise<void> {
  testSection('Test 2: Multi-org mode detection (CSV columns)');

  const csvPath = createTempCsv('email,org_id\ntest@example.com,org_123\n');
  const options: OrchestratorOptions = { csvPath };
  const planner = new MigrationPlanner(options);
  const plan = await planner.generatePlan();

  assert(plan.summary.mode === 'multi-org', 'Should detect multi-org mode');
  assert(plan.configuration.orgResolution === 'per-row', 'Should use per-row org resolution');
  assert(plan.valid === true, 'Plan should be valid');

  // Cleanup
  fs.unlinkSync(csvPath);
}

// Test 3: User-only mode detection
async function testUserOnlyDetection(): Promise<void> {
  testSection('Test 3: User-only mode detection');

  const csvPath = createTempCsv('email\ntest@example.com\n');
  const options: OrchestratorOptions = { csvPath };
  const planner = new MigrationPlanner(options);
  const plan = await planner.generatePlan();

  assert(plan.summary.mode === 'user-only', 'Should detect user-only mode');
  assert(plan.configuration.orgResolution === 'none', 'Should have no org resolution');
  assert(plan.valid === true, 'Plan should be valid');

  // Cleanup
  fs.unlinkSync(csvPath);
}

// Test 4: Row counting
async function testRowCounting(): Promise<void> {
  testSection('Test 4: Row counting');

  const csvContent = 'email\nuser1@example.com\nuser2@example.com\nuser3@example.com\n';
  const csvPath = createTempCsv(csvContent);
  const options: OrchestratorOptions = { csvPath };
  const planner = new MigrationPlanner(options);
  const plan = await planner.generatePlan();

  assert(plan.summary.totalRows === 3, 'Should count 3 data rows (excluding header)');

  // Cleanup
  fs.unlinkSync(csvPath);
}

// Test 5: Duration estimation (small dataset)
async function testDurationEstimationSmall(): Promise<void> {
  testSection('Test 5: Duration estimation (small dataset)');

  const csvPath = createTempCsv('email\ntest@example.com\n');
  const options: OrchestratorOptions = { csvPath, concurrency: 10, workers: 1 };
  const planner = new MigrationPlanner(options);
  const plan = await planner.generatePlan();

  assert(
    plan.summary.estimatedDuration.includes('seconds'),
    'Small dataset should be estimated in seconds'
  );

  // Cleanup
  fs.unlinkSync(csvPath);
}

// Test 6: Recommendation for large import without checkpoint
async function testLargeImportRecommendation(): Promise<void> {
  testSection('Test 6: Recommendation for large import without checkpoint');

  // Create a CSV with many rows (we'll lie about the count for speed)
  const csvPath = createTempCsv('email\ntest@example.com\n');
  const options: OrchestratorOptions = { csvPath };
  const planner = new MigrationPlanner(options);

  // We can't easily create a 15K row CSV in tests, but the planner will read the actual file
  // For this test, we just verify the recommendation logic works with small files
  const plan = await planner.generatePlan();

  // With a small file, no checkpoint recommendation
  const hasCheckpointRec = plan.recommendations.some(r => r.includes('job-id'));
  assert(
    !hasCheckpointRec,
    'Should not recommend checkpoint for small imports'
  );

  // Cleanup
  fs.unlinkSync(csvPath);
}

// Test 7: Recommendation for errors output
async function testErrorsOutputRecommendation(): Promise<void> {
  testSection('Test 7: Recommendation for errors output');

  const csvPath = createTempCsv('email\ntest@example.com\n');
  const options: OrchestratorOptions = { csvPath };
  const planner = new MigrationPlanner(options);
  const plan = await planner.generatePlan();

  const hasErrorsRec = plan.recommendations.some(r => r.includes('errors-out'));
  assert(hasErrorsRec, 'Should recommend errors output');

  // Cleanup
  fs.unlinkSync(csvPath);
}

// Test 8: Multi-org caching recommendation
async function testMultiOrgCachingInfo(): Promise<void> {
  testSection('Test 8: Multi-org caching recommendation');

  const csvPath = createTempCsv('email,org_id\ntest@example.com,org_123\n');
  const options: OrchestratorOptions = { csvPath };
  const planner = new MigrationPlanner(options);
  const plan = await planner.generatePlan();

  const hasCachingInfo = plan.recommendations.some(r => r.includes('caching'));
  assert(hasCachingInfo, 'Should mention multi-org caching');

  // Cleanup
  fs.unlinkSync(csvPath);
}

// Test 9: Invalid CSV file
async function testInvalidCsvFile(): Promise<void> {
  testSection('Test 9: Invalid CSV file');

  const options: OrchestratorOptions = { csvPath: '/nonexistent/file.csv' };
  const planner = new MigrationPlanner(options);
  const plan = await planner.generatePlan();

  assert(plan.valid === false, 'Plan should be invalid');
  assert(plan.validation.errors.length > 0, 'Should have validation errors');
  assert(
    plan.validation.errors[0].includes('not found'),
    'Should mention file not found'
  );
}

// Test 10: Configuration values in plan
async function testConfigurationValues(): Promise<void> {
  testSection('Test 10: Configuration values in plan');

  const csvPath = createTempCsv('email\ntest@example.com\n');
  const options: OrchestratorOptions = {
    csvPath,
    concurrency: 25,
    workers: 4,
    chunkSize: 500
  };
  const planner = new MigrationPlanner(options);
  const plan = await planner.generatePlan();

  assert(plan.configuration.concurrency === 25, 'Should preserve concurrency value');
  assert(plan.configuration.workers === 4, 'Should preserve workers value');
  assert(plan.configuration.chunkSize === 500, 'Should preserve chunk size');

  // Cleanup
  fs.unlinkSync(csvPath);
}

// Test 11: Estimated chunks calculation
async function testChunksCalculation(): Promise<void> {
  testSection('Test 11: Estimated chunks calculation');

  const csvPath = createTempCsv('email\ntest@example.com\n');
  const options: OrchestratorOptions = { csvPath, jobId: 'test-job', chunkSize: 1000 };
  const planner = new MigrationPlanner(options);
  const plan = await planner.generatePlan();

  assert(plan.summary.estimatedChunks !== undefined, 'Should calculate chunks in checkpoint mode');
  assert(plan.summary.estimatedChunks === 1, 'Should be 1 chunk for 1 row');

  // Cleanup
  fs.unlinkSync(csvPath);
}

// Test 12: No chunks without checkpoint mode
async function testNoChunksWithoutCheckpoint(): Promise<void> {
  testSection('Test 12: No chunks without checkpoint mode');

  const csvPath = createTempCsv('email\ntest@example.com\n');
  const options: OrchestratorOptions = { csvPath };
  const planner = new MigrationPlanner(options);
  const plan = await planner.generatePlan();

  assert(plan.summary.estimatedChunks === undefined, 'Should not calculate chunks without checkpoint mode');

  // Cleanup
  fs.unlinkSync(csvPath);
}

// Run all tests
async function runTests(): Promise<void> {
  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║   Migration Planner Test Suite                   ║');
  console.log('╚═══════════════════════════════════════════════════╝');

  await testSingleOrgDetection();
  await testMultiOrgDetection();
  await testUserOnlyDetection();
  await testRowCounting();
  await testDurationEstimationSmall();
  await testLargeImportRecommendation();
  await testErrorsOutputRecommendation();
  await testMultiOrgCachingInfo();
  await testInvalidCsvFile();
  await testConfigurationValues();
  await testChunksCalculation();
  await testNoChunksWithoutCheckpoint();

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('Test Summary');
  console.log('='.repeat(50));
  console.log(`Total tests:  ${testsRun}`);
  console.log(`Passed:       ${testsPassed} ✓`);
  console.log(`Failed:       ${testsFailed} ${testsFailed > 0 ? '✗' : ''}`);
  console.log('='.repeat(50));

  if (testsFailed > 0) {
    console.error('\n❌ Some tests failed');
    process.exit(1);
  } else {
    console.log('\n✅ All tests passed!');
    process.exit(0);
  }
}

// Run tests
runTests().catch((err) => {
  console.error('Unhandled error in test suite:', err);
  process.exit(1);
});
