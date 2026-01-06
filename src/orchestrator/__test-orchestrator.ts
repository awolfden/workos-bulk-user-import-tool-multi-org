#!/usr/bin/env npx tsx
/**
 * Phase 5: Migration Orchestrator Tests
 *
 * Tests the main orchestrator class (plan and execute).
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
  const tmpFile = path.join(os.tmpdir(), `test-orch-${Date.now()}-${Math.random()}.csv`);
  fs.writeFileSync(tmpFile, content);
  return tmpFile;
}

// Test 1: Plan generation works
async function testPlanGeneration(): Promise<void> {
  testSection('Test 1: Plan generation works');

  const csvPath = createTempCsv('email\ntest@example.com\n');
  const options: OrchestratorOptions = { csvPath, orgId: 'org_123' };
  const orchestrator = new MigrationOrchestrator(options);
  const plan = await orchestrator.plan();

  assert(plan !== null, 'Should generate a plan');
  assert(plan.summary.totalRows === 1, 'Should count 1 row');
  assert(plan.summary.mode === 'single-org', 'Should detect single-org mode');
  assert(plan.valid === true, 'Plan should be valid');

  // Cleanup
  fs.unlinkSync(csvPath);
}

// Test 2: Plan validation catches errors
async function testPlanValidationErrors(): Promise<void> {
  testSection('Test 2: Plan validation catches errors');

  const csvPath = createTempCsv('email\ntest@example.com\n');
  const options: OrchestratorOptions = {
    csvPath,
    workers: 4 // Workers without checkpoint should error
  };
  const orchestrator = new MigrationOrchestrator(options);
  const plan = await orchestrator.plan();

  assert(plan.valid === false, 'Plan should be invalid');
  assert(plan.validation.errors.length > 0, 'Should have errors');

  // Cleanup
  fs.unlinkSync(csvPath);
}

// Test 3: Execute with dry-run succeeds
async function testExecuteWithDryRun(): Promise<void> {
  testSection('Test 3: Execute with dry-run succeeds');

  const csvPath = createTempCsv('email\ntest@example.com\n');
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
    assert(false, 'Should not throw error in dry-run mode');
    fs.unlinkSync(csvPath);
    return;
  }

  assert(result !== null, 'Should return result');
  assert(result.summary !== null, 'Should have summary');
  assert(result.duration >= 0, 'Should track duration');

  // Cleanup
  fs.unlinkSync(csvPath);
}

// Test 4: Execute fails with invalid configuration
async function testExecuteWithInvalidConfig(): Promise<void> {
  testSection('Test 4: Execute fails with invalid configuration');

  const csvPath = createTempCsv('email\ntest@example.com\n');
  const options: OrchestratorOptions = {
    csvPath,
    workers: 4, // Workers without checkpoint should fail
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

// Test 5: Execute with single-org mode (dry-run)
async function testExecuteSingleOrg(): Promise<void> {
  testSection('Test 5: Execute with single-org mode (dry-run)');

  const csvPath = createTempCsv('email\ntest@example.com\n');
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
  assert(result.summary !== undefined, 'Should have summary object');

  // Cleanup
  fs.unlinkSync(csvPath);
}

// Test 6: Execute with multi-org CSV (dry-run)
async function testExecuteMultiOrg(): Promise<void> {
  testSection('Test 6: Execute with multi-org CSV (dry-run)');

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
  assert(result.summary !== undefined, 'Should have summary object');

  // Cleanup
  fs.unlinkSync(csvPath);
}

// Test 7: Result includes duration
async function testResultIncludesDuration(): Promise<void> {
  testSection('Test 7: Result includes duration');

  const csvPath = createTempCsv('email\ntest@example.com\n');
  const options: OrchestratorOptions = {
    csvPath,
    dryRun: true,
    quiet: true
  };
  const orchestrator = new MigrationOrchestrator(options);

  const result = await orchestrator.execute();

  assert(typeof result.duration === 'number', 'Duration should be a number');
  assert(result.duration >= 0, 'Duration should be non-negative');
  assert(result.duration < 10000, 'Duration should be reasonable (<10s) for small file');

  // Cleanup
  fs.unlinkSync(csvPath);
}

// Test 8: Success flag and summary exist
async function testSuccessFlagAndSummary(): Promise<void> {
  testSection('Test 8: Success flag and summary exist');

  const csvPath = createTempCsv('email\ntest@example.com\n');
  const options: OrchestratorOptions = {
    csvPath,
    dryRun: true,
    quiet: true
  };
  const orchestrator = new MigrationOrchestrator(options);

  const result = await orchestrator.execute();

  // Check that result structure is valid
  assert(typeof result.success === 'boolean', 'Should have success flag');
  assert(result.summary !== undefined, 'Should have summary object');
  assert(result.duration !== undefined, 'Should have duration');

  // Cleanup
  fs.unlinkSync(csvPath);
}

// Run all tests
async function runTests(): Promise<void> {
  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║   Migration Orchestrator Test Suite              ║');
  console.log('╚═══════════════════════════════════════════════════╝');

  await testPlanGeneration();
  await testPlanValidationErrors();
  await testExecuteWithDryRun();
  await testExecuteWithInvalidConfig();
  await testExecuteSingleOrg();
  await testExecuteMultiOrg();
  await testResultIncludesDuration();
  await testSuccessFlagAndSummary();

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
