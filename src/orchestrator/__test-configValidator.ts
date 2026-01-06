#!/usr/bin/env npx tsx
/**
 * Phase 5: Configuration Validator Tests
 *
 * Tests all validation rules for orchestrator configuration.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { validateConfig } from './configValidator.js';
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
function createTempCsv(content: string = 'email\ntest@example.com\n'): string {
  const tmpFile = path.join(os.tmpdir(), `test-${Date.now()}.csv`);
  fs.writeFileSync(tmpFile, content);
  return tmpFile;
}

// Helper to create minimal valid options
function createOptions(overrides: Partial<OrchestratorOptions> = {}): OrchestratorOptions {
  return {
    csvPath: createTempCsv(),
    ...overrides
  };
}

// Test 1: Valid single-org configuration
function testValidSingleOrgConfig(): void {
  testSection('Test 1: Valid single-org configuration');

  const options = createOptions({ orgId: 'org_123' });
  const result = validateConfig(options, 'single-org', 1000);

  assert(result.errors.length === 0, 'Should have no errors');
  assert(result.warnings.length === 0, 'Should have no warnings');

  // Cleanup
  fs.unlinkSync(options.csvPath);
}

// Test 2: Single-org missing org identifier
function testSingleOrgMissingIdentifier(): void {
  testSection('Test 2: Single-org missing org identifier');

  const options = createOptions();
  const result = validateConfig(options, 'single-org', 1000);

  assert(result.errors.length === 1, 'Should have 1 error');
  assert(
    result.errors[0].includes('requires --org-id'),
    'Should mention missing org identifier'
  );

  // Cleanup
  fs.unlinkSync(options.csvPath);
}

// Test 3: Mutual exclusivity (org-id vs org-external-id)
function testMutualExclusivity(): void {
  testSection('Test 3: Mutual exclusivity (org-id vs org-external-id)');

  const options = createOptions({
    orgId: 'org_123',
    orgExternalId: 'ext_123'
  });
  const result = validateConfig(options, 'single-org', 1000);

  assert(result.errors.length === 1, 'Should have 1 error');
  assert(
    result.errors[0].includes('Cannot specify both'),
    'Should mention mutual exclusivity'
  );

  // Cleanup
  fs.unlinkSync(options.csvPath);
}

// Test 4: Workers require checkpoint mode
function testWorkersRequireCheckpoint(): void {
  testSection('Test 4: Workers require checkpoint mode');

  const options = createOptions({ workers: 4 });
  const result = validateConfig(options, 'multi-org', 1000);

  assert(result.errors.length === 1, 'Should have 1 error');
  assert(result.errors[0].includes('requires checkpoint'), 'Should mention checkpoint requirement');

  // Cleanup
  fs.unlinkSync(options.csvPath);
}

// Test 5: Valid worker configuration
function testValidWorkerConfig(): void {
  testSection('Test 5: Valid worker configuration');

  const options = createOptions({ workers: 4, jobId: 'test-job' });
  const result = validateConfig(options, 'multi-org', 1000);

  assert(result.errors.length === 0, 'Should have no errors');

  // Cleanup
  fs.unlinkSync(options.csvPath);
}

// Test 6: CSV file not found
function testCsvNotFound(): void {
  testSection('Test 6: CSV file not found');

  const options: OrchestratorOptions = {
    csvPath: '/nonexistent/file.csv',
    orgId: 'org_123'
  };
  const result = validateConfig(options, 'single-org', 1000);

  assert(result.errors.length === 1, 'Should have 1 error');
  assert(result.errors[0].includes('not found'), 'Should mention file not found');
}

// Test 7: Warning for large import without checkpoint
function testLargeImportWarning(): void {
  testSection('Test 7: Warning for large import without checkpoint');

  const options = createOptions({ orgId: 'org_123' });
  const result = validateConfig(options, 'single-org', 15000);

  assert(result.errors.length === 0, 'Should have no errors');
  assert(result.warnings.length === 1, 'Should have 1 warning');
  assert(
    result.warnings[0].includes('Large import'),
    'Should warn about large import'
  );

  // Cleanup
  fs.unlinkSync(options.csvPath);
}

// Test 8: Multi-org mode with single-org flags (warning)
function testMultiOrgWithSingleOrgFlags(): void {
  testSection('Test 8: Multi-org mode with single-org flags');

  const options = createOptions({ orgId: 'org_123' });
  const result = validateConfig(options, 'multi-org', 1000);

  assert(result.errors.length === 0, 'Should have no errors');
  assert(result.warnings.length === 1, 'Should have 1 warning');
  assert(
    result.warnings[0].includes('will be ignored'),
    'Should warn flags will be ignored'
  );

  // Cleanup
  fs.unlinkSync(options.csvPath);
}

// Test 9: Invalid concurrency
function testInvalidConcurrency(): void {
  testSection('Test 9: Invalid concurrency');

  const options = createOptions({ orgId: 'org_123', concurrency: 0 });
  const result = validateConfig(options, 'single-org', 1000);

  assert(result.errors.length === 1, 'Should have 1 error');
  assert(
    result.errors[0].includes('concurrency must be >= 1'),
    'Should mention concurrency validation'
  );

  // Cleanup
  fs.unlinkSync(options.csvPath);
}

// Test 10: Resume without job-id
function testResumeWithoutJobId(): void {
  testSection('Test 10: Resume without job-id');

  const options = createOptions({ orgId: 'org_123', resume: true });
  const result = validateConfig(options, 'single-org', 1000);

  assert(result.errors.length === 1, 'Should have 1 error');
  assert(
    result.errors[0].includes('resume requires --job-id'),
    'Should mention job-id requirement'
  );

  // Cleanup
  fs.unlinkSync(options.csvPath);
}

// Test 11: Valid multi-org configuration
function testValidMultiOrgConfig(): void {
  testSection('Test 11: Valid multi-org configuration');

  const options = createOptions();
  const result = validateConfig(options, 'multi-org', 1000);

  assert(result.errors.length === 0, 'Should have no errors');
  assert(result.warnings.length === 0, 'Should have no warnings');

  // Cleanup
  fs.unlinkSync(options.csvPath);
}

// Test 12: Valid user-only configuration
function testValidUserOnlyConfig(): void {
  testSection('Test 12: Valid user-only configuration');

  const options = createOptions();
  const result = validateConfig(options, 'user-only', 1000);

  assert(result.errors.length === 0, 'Should have no errors');
  assert(result.warnings.length === 0, 'Should have no warnings');

  // Cleanup
  fs.unlinkSync(options.csvPath);
}

// Run all tests
async function runTests(): Promise<void> {
  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║   Configuration Validator Test Suite             ║');
  console.log('╚═══════════════════════════════════════════════════╝');

  testValidSingleOrgConfig();
  testSingleOrgMissingIdentifier();
  testMutualExclusivity();
  testWorkersRequireCheckpoint();
  testValidWorkerConfig();
  testCsvNotFound();
  testLargeImportWarning();
  testMultiOrgWithSingleOrgFlags();
  testInvalidConcurrency();
  testResumeWithoutJobId();
  testValidMultiOrgConfig();
  testValidUserOnlyConfig();

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
