#!/usr/bin/env npx tsx
/**
 * Phase 5: Import Orchestrator Integration Tests
 *
 * End-to-end tests with real CSV files.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MigrationOrchestrator } from './migrationOrchestrator.js';
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
  const tmpFile = path.join(os.tmpdir(), `test-orch-int-${Date.now()}-${Math.random()}.csv`);
  fs.writeFileSync(tmpFile, content);
  return tmpFile;
}

// Test 1: End-to-end single-org planning
async function testEndToEndSingleOrgPlanning(): Promise<void> {
  testSection('Test 1: End-to-end single-org planning');

  const csvPath = createTempCsv('email,first_name,last_name\ntest@example.com,Test,User\n');
  const options: OrchestratorOptions = {
    csvPath,
    orgId: 'org_test123'
  };

  const orchestrator = new MigrationOrchestrator(options);
  const plan = await orchestrator.plan();

  assert(plan !== null, 'Should generate a plan');
  assert(plan.valid === true, 'Plan should be valid');
  assert(plan.summary.mode === 'single-org', 'Should detect single-org mode');
  assert(plan.summary.totalRows === 1, 'Should count 1 row');
  assert(plan.configuration.orgResolution === 'upfront', 'Should use upfront org resolution');
  assert(plan.validation.errors.length === 0, 'Should have no errors');

  // Cleanup
  fs.unlinkSync(csvPath);
}

// Test 2: End-to-end multi-org planning
async function testEndToEndMultiOrgPlanning(): Promise<void> {
  testSection('Test 2: End-to-end multi-org planning');

  const csvPath = createTempCsv('email,first_name,last_name,org_id\ntest@example.com,Test,User,org_123\n');
  const options: OrchestratorOptions = {
    csvPath
  };

  const orchestrator = new MigrationOrchestrator(options);
  const plan = await orchestrator.plan();

  assert(plan !== null, 'Should generate a plan');
  assert(plan.valid === true, 'Plan should be valid');
  assert(plan.summary.mode === 'multi-org', 'Should detect multi-org mode');
  assert(plan.summary.totalRows === 1, 'Should count 1 row');
  assert(plan.configuration.orgResolution === 'per-row', 'Should use per-row org resolution');

  // Cleanup
  fs.unlinkSync(csvPath);
}

// Test 3: End-to-end user-only planning
async function testEndToEndUserOnlyPlanning(): Promise<void> {
  testSection('Test 3: End-to-end user-only planning');

  const csvPath = createTempCsv('email,first_name,last_name\ntest@example.com,Test,User\n');
  const options: OrchestratorOptions = {
    csvPath
  };

  const orchestrator = new MigrationOrchestrator(options);
  const plan = await orchestrator.plan();

  assert(plan !== null, 'Should generate a plan');
  assert(plan.valid === true, 'Plan should be valid');
  assert(plan.summary.mode === 'user-only', 'Should detect user-only mode');
  assert(plan.configuration.orgResolution === 'none', 'Should have no org resolution');

  // Cleanup
  fs.unlinkSync(csvPath);
}

// Test 4: Planning with workers (should warn without checkpoint)
async function testPlanningWithWorkersWarning(): Promise<void> {
  testSection('Test 4: Planning with workers (should warn without checkpoint)');

  const csvPath = createTempCsv('email\ntest@example.com\n');
  const options: OrchestratorOptions = {
    csvPath,
    workers: 4
  };

  const orchestrator = new MigrationOrchestrator(options);
  const plan = await orchestrator.plan();

  assert(plan !== null, 'Should generate a plan');
  assert(plan.valid === false, 'Plan should be invalid');
  assert(plan.validation.errors.length > 0, 'Should have validation errors');
  assert(
    plan.validation.errors.some(e => e.includes('Worker mode') && e.includes('checkpoint mode')),
    'Should warn about workers requiring checkpoint'
  );

  // Cleanup
  fs.unlinkSync(csvPath);
}

// Test 5: Planning with large file (recommendations)
async function testPlanningWithLargeFile(): Promise<void> {
  testSection('Test 5: Planning with large file (recommendations)');

  // Create a CSV with 15K rows (simulated with comment about actual row count)
  let csvContent = 'email\n';
  for (let i = 0; i < 15000; i++) {
    csvContent += `user${i}@example.com\n`;
  }
  const csvPath = createTempCsv(csvContent);

  const options: OrchestratorOptions = {
    csvPath
  };

  const orchestrator = new MigrationOrchestrator(options);
  const plan = await orchestrator.plan();

  assert(plan !== null, 'Should generate a plan');
  assert(plan.summary.totalRows === 15000, 'Should count 15000 rows');
  assert(plan.recommendations.length > 0, 'Should have recommendations');
  assert(
    plan.recommendations.some(r => r.includes('job-id')),
    'Should recommend checkpoint for large import'
  );
  assert(
    plan.recommendations.some(r => r.includes('errors-out')),
    'Should recommend errors output'
  );

  // Cleanup
  fs.unlinkSync(csvPath);
}

// Test 6: Execution with dry-run (single-org)
async function testExecutionWithDryRunSingleOrg(): Promise<void> {
  testSection('Test 6: Execution with dry-run (single-org)');

  const csvPath = createTempCsv('email,first_name\ntest@example.com,Test\n');
  const options: OrchestratorOptions = {
    csvPath,
    orgId: 'org_test123',
    dryRun: true,
    quiet: true
  };

  const orchestrator = new MigrationOrchestrator(options);

  let result;
  try {
    result = await orchestrator.execute();
  } catch (err) {
    console.error(`Execution error: ${err}`);
    assert(false, `Should not throw error: ${err}`);
    fs.unlinkSync(csvPath);
    return;
  }

  assert(result !== null, 'Should return result');
  assert(typeof result.success === 'boolean', 'Should have success flag');
  assert(result.summary !== undefined, 'Should have summary');
  assert(result.duration >= 0, 'Should track duration');

  // Cleanup
  fs.unlinkSync(csvPath);
}

// Test 7: Execution with dry-run (multi-org)
async function testExecutionWithDryRunMultiOrg(): Promise<void> {
  testSection('Test 7: Execution with dry-run (multi-org)');

  const csvPath = createTempCsv('email,org_id\ntest@example.com,org_123\n');
  const options: OrchestratorOptions = {
    csvPath,
    dryRun: true,
    quiet: true
  };

  const orchestrator = new MigrationOrchestrator(options);

  let result;
  try {
    result = await orchestrator.execute();
  } catch (err) {
    console.error(`Execution error: ${err}`);
    assert(false, `Should not throw error: ${err}`);
    fs.unlinkSync(csvPath);
    return;
  }

  assert(result !== null, 'Should return result');
  assert(result.summary !== undefined, 'Should have summary');

  // Cleanup
  fs.unlinkSync(csvPath);
}

// Test 8: Execution fails with invalid plan
async function testExecutionFailsWithInvalidPlan(): Promise<void> {
  testSection('Test 8: Execution fails with invalid plan');

  const csvPath = createTempCsv('email\ntest@example.com\n');
  const options: OrchestratorOptions = {
    csvPath,
    workers: 4,  // Workers without checkpoint should fail
    dryRun: true,
    quiet: true
  };

  const orchestrator = new MigrationOrchestrator(options);

  let didThrow = false;
  try {
    await orchestrator.execute();
  } catch (err) {
    didThrow = true;
    const errorMessage = err instanceof Error ? err.message : String(err);
    assert(
      errorMessage.includes('invalid'),
      'Error should mention invalid plan'
    );
  }

  assert(didThrow, 'Should throw error for invalid configuration');

  // Cleanup
  fs.unlinkSync(csvPath);
}

// Test 9: Planning with checkpoint mode (chunks calculation)
async function testPlanningWithCheckpointMode(): Promise<void> {
  testSection('Test 9: Planning with checkpoint mode (chunks calculation)');

  const csvPath = createTempCsv('email\ntest@example.com\n');
  const options: OrchestratorOptions = {
    csvPath,
    jobId: 'test-job',
    chunkSize: 1000
  };

  const orchestrator = new MigrationOrchestrator(options);
  const plan = await orchestrator.plan();

  assert(plan !== null, 'Should generate a plan');
  assert(plan.summary.estimatedChunks !== undefined, 'Should calculate chunks');
  assert(plan.summary.estimatedChunks === 1, 'Should be 1 chunk for 1 row');

  // Cleanup
  fs.unlinkSync(csvPath);
}

// Test 10: Planning with mutual exclusivity error
async function testPlanningWithMutualExclusivity(): Promise<void> {
  testSection('Test 10: Planning with mutual exclusivity error');

  const csvPath = createTempCsv('email\ntest@example.com\n');
  const options: OrchestratorOptions = {
    csvPath,
    orgId: 'org_123',
    orgExternalId: 'org_ext_456'
  };

  const orchestrator = new MigrationOrchestrator(options);
  const plan = await orchestrator.plan();

  assert(plan.valid === false, 'Plan should be invalid');
  assert(plan.validation.errors.length > 0, 'Should have errors');
  assert(
    plan.validation.errors.some(e => e.includes('Cannot specify both --org-id and --org-external-id')),
    'Should error about mutual exclusivity'
  );

  // Cleanup
  fs.unlinkSync(csvPath);
}

// Test 11: Duration estimation scales with workers and concurrency
async function testDurationEstimationScaling(): Promise<void> {
  testSection('Test 11: Duration estimation scales with workers and concurrency');

  // Create CSV with 1000 rows
  let csvContent = 'email\n';
  for (let i = 0; i < 1000; i++) {
    csvContent += `user${i}@example.com\n`;
  }
  const csvPath = createTempCsv(csvContent);

  // Test 1: Default (1 worker, 10 concurrency)
  const options1: OrchestratorOptions = { csvPath };
  const orchestrator1 = new MigrationOrchestrator(options1);
  const plan1 = await orchestrator1.plan();

  // Test 2: Higher concurrency (1 worker, 20 concurrency)
  const options2: OrchestratorOptions = { csvPath, concurrency: 20, jobId: 'test' };
  const orchestrator2 = new MigrationOrchestrator(options2);
  const plan2 = await orchestrator2.plan();

  // Test 3: Multiple workers (4 workers, 10 concurrency)
  const options3: OrchestratorOptions = { csvPath, workers: 4, jobId: 'test' };
  const orchestrator3 = new MigrationOrchestrator(options3);
  const plan3 = await orchestrator3.plan();

  assert(plan1.summary.estimatedDuration !== plan2.summary.estimatedDuration,
    'Duration should differ with different concurrency');
  assert(plan1.summary.estimatedDuration !== plan3.summary.estimatedDuration,
    'Duration should differ with different worker count');

  // Cleanup
  fs.unlinkSync(csvPath);
}

// Test 12: Recommendations appear based on row count
async function testRecommendationsBasedOnRowCount(): Promise<void> {
  testSection('Test 12: Recommendations appear based on row count');

  // Small file (no checkpoint recommendation)
  const smallCsvPath = createTempCsv('email\ntest@example.com\n');
  const smallOptions: OrchestratorOptions = { csvPath: smallCsvPath };
  const smallOrchestrator = new MigrationOrchestrator(smallOptions);
  const smallPlan = await smallOrchestrator.plan();

  const hasCheckpointRec = smallPlan.recommendations.some(r => r.includes('job-id'));
  assert(!hasCheckpointRec, 'Should not recommend checkpoint for small import');

  // Large file (should recommend checkpoint)
  let largeCsvContent = 'email\n';
  for (let i = 0; i < 15000; i++) {
    largeCsvContent += `user${i}@example.com\n`;
  }
  const largeCsvPath = createTempCsv(largeCsvContent);
  const largeOptions: OrchestratorOptions = { csvPath: largeCsvPath };
  const largeOrchestrator = new MigrationOrchestrator(largeOptions);
  const largePlan = await largeOrchestrator.plan();

  const hasLargeCheckpointRec = largePlan.recommendations.some(r => r.includes('job-id'));
  assert(hasLargeCheckpointRec, 'Should recommend checkpoint for large import');

  // Cleanup
  fs.unlinkSync(smallCsvPath);
  fs.unlinkSync(largeCsvPath);
}

// Run all tests
async function runTests(): Promise<void> {
  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║   Import Orchestrator Integration Test Suite     ║');
  console.log('╚═══════════════════════════════════════════════════╝');

  await testEndToEndSingleOrgPlanning();
  await testEndToEndMultiOrgPlanning();
  await testEndToEndUserOnlyPlanning();
  await testPlanningWithWorkersWarning();
  await testPlanningWithLargeFile();
  await testExecutionWithDryRunSingleOrg();
  await testExecutionWithDryRunMultiOrg();
  await testExecutionFailsWithInvalidPlan();
  await testPlanningWithCheckpointMode();
  await testPlanningWithMutualExclusivity();
  await testDurationEstimationScaling();
  await testRecommendationsBasedOnRowCount();

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
