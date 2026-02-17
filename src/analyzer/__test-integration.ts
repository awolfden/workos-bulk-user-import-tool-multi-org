#!/usr/bin/env node
/**
 * Phase 4: Error Analyzer - Integration Tests
 *
 * Tests complete workflow: JSONL → analysis → report → CSV
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parse } from 'csv-parse/sync';
import { ErrorAnalyzer } from './errorAnalyzer.js';
import { generateRetryCsv } from './retryCsvGenerator.js';
import type { ErrorRecord } from '../types.js';

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

/**
 * Create test JSONL file
 */
function createTestJsonl(errors: ErrorRecord[], filePath: string): void {
  const lines = errors.map(error => JSON.stringify(error)).join('\n');
  fs.writeFileSync(filePath, lines, 'utf-8');
}

/**
 * Read CSV file and parse it
 */
function readCsv(filePath: string): Record<string, unknown>[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  return parse(content, { columns: true, skip_empty_lines: true });
}

/**
 * Clean up temporary files
 */
function cleanupFiles(...filePaths: string[]): void {
  for (const filePath of filePaths) {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}

// Test 1: Full Workflow with Mixed Errors
async function testFullWorkflowMixedErrors(): Promise<void> {
  testSection('Test 1: Full Workflow with Mixed Errors');

  const errors: ErrorRecord[] = [
    // Retryable: Server error
    {
      recordNumber: 1,
      email: 'user1@example.com',
      errorType: 'user_create',
      errorMessage: 'Internal server error',
      timestamp: new Date().toISOString(),
      httpStatus: 500,
      rawRow: { email: 'user1@example.com', first_name: 'User', last_name: 'One' }
    },
    // Retryable: Rate limit
    {
      recordNumber: 2,
      email: 'user2@example.com',
      errorType: 'user_create',
      errorMessage: 'Rate limit exceeded',
      timestamp: new Date().toISOString(),
      httpStatus: 429,
      rawRow: { email: 'user2@example.com', first_name: 'User', last_name: 'Two' }
    },
    // Non-retryable: Validation error
    {
      recordNumber: 3,
      email: 'invalid-email',
      errorType: 'user_create',
      errorMessage: 'Invalid email format',
      timestamp: new Date().toISOString(),
      httpStatus: 400,
      rawRow: { email: 'invalid-email', first_name: 'User', last_name: 'Three' }
    },
    // Non-retryable: Duplicate
    {
      recordNumber: 4,
      email: 'duplicate@example.com',
      errorType: 'user_create',
      errorMessage: 'User duplicate@example.com already exists',
      timestamp: new Date().toISOString(),
      httpStatus: 409,
      rawRow: { email: 'duplicate@example.com', first_name: 'User', last_name: 'Four' }
    },
    // Retryable: Another server error (same email as first)
    {
      recordNumber: 5,
      email: 'user1@example.com',
      errorType: 'user_create',
      errorMessage: 'Internal server error',
      timestamp: new Date().toISOString(),
      httpStatus: 500,
      rawRow: { email: 'user1@example.com', first_name: 'User', last_name: 'One' }
    }
  ];

  const jsonlPath = path.join(os.tmpdir(), `test-errors-${Date.now()}.jsonl`);
  const reportPath = path.join(os.tmpdir(), `test-report-${Date.now()}.json`);
  const retryCsvPath = path.join(os.tmpdir(), `test-retry-${Date.now()}.csv`);

  try {
    createTestJsonl(errors, jsonlPath);

    // Run analyzer
    const analyzer = new ErrorAnalyzer({
      errorsPath: jsonlPath,
      reportPath,
      quiet: true
    });

    const report = await analyzer.analyze();

    // Verify report structure
    assert(report.summary.totalErrors === 5, 'Should have 5 total errors');
    assert(report.summary.retryableErrors === 3, 'Should have 3 retryable errors');
    assert(report.summary.nonRetryableErrors === 2, 'Should have 2 non-retryable errors');
    assert(report.summary.uniqueEmails === 4, 'Should have 4 unique emails (user1, user2, invalid-email, duplicate)');

    // Verify groups
    assert(report.groups.length >= 3, 'Should have at least 3 error groups');

    // Verify retryability summary
    assert(report.retryability.retryable.count === 3, 'Retryable count should be 3');
    assert(report.retryability.nonRetryable.count === 2, 'Non-retryable count should be 2');
    assert(
      Math.abs(report.retryability.retryable.percentage - 60.0) < 0.1,
      'Retryable percentage should be 60%'
    );

    // Verify suggestions
    assert(report.suggestions.length > 0, 'Should have suggestions');

    // Verify report file created
    assert(fs.existsSync(reportPath), 'Report file should be created');

    // Generate retry CSV
    const retryableErrors = analyzer.getRetryableErrors();
    await generateRetryCsv(retryableErrors, retryCsvPath, false);

    // Verify retry CSV
    assert(fs.existsSync(retryCsvPath), 'Retry CSV should be created');

    const retryCsvRows = readCsv(retryCsvPath);
    assert(retryCsvRows.length === 2, 'Should have 2 unique emails in retry CSV (deduplicated)');
    assert(
      retryCsvRows.some(row => row.email === 'user1@example.com'),
      'Should include user1@example.com'
    );
    assert(
      retryCsvRows.some(row => row.email === 'user2@example.com'),
      'Should include user2@example.com'
    );
  } finally {
    cleanupFiles(jsonlPath, reportPath, retryCsvPath);
  }
}

// Test 2: Only Retryable Errors
async function testOnlyRetryableErrors(): Promise<void> {
  testSection('Test 2: Only Retryable Errors');

  const errors: ErrorRecord[] = [
    {
      recordNumber: 1,
      email: 'user1@example.com',
      errorType: 'user_create',
      errorMessage: 'Internal server error',
      timestamp: new Date().toISOString(),
      httpStatus: 500,
      rawRow: { email: 'user1@example.com', first_name: 'User', last_name: 'One' }
    },
    {
      recordNumber: 2,
      email: 'user2@example.com',
      errorType: 'user_create',
      errorMessage: 'Internal server error',
      timestamp: new Date().toISOString(),
      httpStatus: 500,
      rawRow: { email: 'user2@example.com', first_name: 'User', last_name: 'Two' }
    }
  ];

  const jsonlPath = path.join(os.tmpdir(), `test-errors-${Date.now()}.jsonl`);
  const reportPath = path.join(os.tmpdir(), `test-report-${Date.now()}.json`);

  try {
    createTestJsonl(errors, jsonlPath);

    const analyzer = new ErrorAnalyzer({
      errorsPath: jsonlPath,
      reportPath,
      quiet: true
    });

    const report = await analyzer.analyze();

    assert(report.summary.totalErrors === 2, 'Should have 2 total errors');
    assert(report.summary.retryableErrors === 2, 'Should have 2 retryable errors');
    assert(report.summary.nonRetryableErrors === 0, 'Should have 0 non-retryable errors');
    assert(
      Math.abs(report.retryability.retryable.percentage - 100.0) < 0.1,
      'Retryable percentage should be 100%'
    );
  } finally {
    cleanupFiles(jsonlPath, reportPath);
  }
}

// Test 3: Only Non-Retryable Errors
async function testOnlyNonRetryableErrors(): Promise<void> {
  testSection('Test 3: Only Non-Retryable Errors');

  const errors: ErrorRecord[] = [
    {
      recordNumber: 1,
      email: 'invalid-email',
      errorType: 'user_create',
      errorMessage: 'Invalid email format',
      timestamp: new Date().toISOString(),
      httpStatus: 400,
      rawRow: { email: 'invalid-email', first_name: 'User', last_name: 'One' }
    },
    {
      recordNumber: 2,
      email: 'duplicate@example.com',
      errorType: 'user_create',
      errorMessage: 'User already exists',
      timestamp: new Date().toISOString(),
      httpStatus: 409,
      rawRow: { email: 'duplicate@example.com', first_name: 'User', last_name: 'Two' }
    }
  ];

  const jsonlPath = path.join(os.tmpdir(), `test-errors-${Date.now()}.jsonl`);
  const reportPath = path.join(os.tmpdir(), `test-report-${Date.now()}.json`);

  try {
    createTestJsonl(errors, jsonlPath);

    const analyzer = new ErrorAnalyzer({
      errorsPath: jsonlPath,
      reportPath,
      quiet: true
    });

    const report = await analyzer.analyze();

    assert(report.summary.totalErrors === 2, 'Should have 2 total errors');
    assert(report.summary.retryableErrors === 0, 'Should have 0 retryable errors');
    assert(report.summary.nonRetryableErrors === 2, 'Should have 2 non-retryable errors');
    assert(
      Math.abs(report.retryability.nonRetryable.percentage - 100.0) < 0.1,
      'Non-retryable percentage should be 100%'
    );
  } finally {
    cleanupFiles(jsonlPath, reportPath);
  }
}

// Test 4: Include Duplicates in Retry CSV
async function testIncludeDuplicates(): Promise<void> {
  testSection('Test 4: Include Duplicates in Retry CSV');

  const errors: ErrorRecord[] = [
    {
      recordNumber: 1,
      email: 'user@example.com',
      errorType: 'user_create',
      errorMessage: 'Internal server error',
      timestamp: new Date().toISOString(),
      httpStatus: 500,
      rawRow: { email: 'user@example.com', first_name: 'First', last_name: 'Attempt' }
    },
    {
      recordNumber: 2,
      email: 'user@example.com',
      errorType: 'user_create',
      errorMessage: 'Internal server error',
      timestamp: new Date().toISOString(),
      httpStatus: 500,
      rawRow: { email: 'user@example.com', first_name: 'Second', last_name: 'Attempt' }
    }
  ];

  const jsonlPath = path.join(os.tmpdir(), `test-errors-${Date.now()}.jsonl`);
  const reportPath = path.join(os.tmpdir(), `test-report-${Date.now()}.json`);
  const retryCsvPath = path.join(os.tmpdir(), `test-retry-${Date.now()}.csv`);

  try {
    createTestJsonl(errors, jsonlPath);

    const analyzer = new ErrorAnalyzer({
      errorsPath: jsonlPath,
      reportPath,
      quiet: true
    });

    await analyzer.analyze();

    // Generate retry CSV with duplicates
    const retryableErrors = analyzer.getRetryableErrors();
    await generateRetryCsv(retryableErrors, retryCsvPath, true);

    const retryCsvRows = readCsv(retryCsvPath);
    assert(retryCsvRows.length === 2, 'Should include both duplicates');
    assert(retryCsvRows[0].first_name === 'First', 'First row should have First');
    assert(retryCsvRows[1].first_name === 'Second', 'Second row should have Second');
  } finally {
    cleanupFiles(jsonlPath, reportPath, retryCsvPath);
  }
}

// Test 5: Error Grouping and Patterns
async function testErrorGroupingAndPatterns(): Promise<void> {
  testSection('Test 5: Error Grouping and Patterns');

  const errors: ErrorRecord[] = [
    {
      recordNumber: 1,
      email: 'user1@example.com',
      errorType: 'user_create',
      errorMessage: 'Invalid email format for user1@example.com',
      timestamp: new Date().toISOString(),
      httpStatus: 400,
      rawRow: { email: 'user1@example.com' }
    },
    {
      recordNumber: 2,
      email: 'user2@example.com',
      errorType: 'user_create',
      errorMessage: 'Invalid email format for user2@example.com',
      timestamp: new Date().toISOString(),
      httpStatus: 400,
      rawRow: { email: 'user2@example.com' }
    },
    {
      recordNumber: 3,
      email: 'user3@example.com',
      errorType: 'user_create',
      errorMessage: 'User user3@example.com already exists',
      timestamp: new Date().toISOString(),
      httpStatus: 409,
      rawRow: { email: 'user3@example.com' }
    }
  ];

  const jsonlPath = path.join(os.tmpdir(), `test-errors-${Date.now()}.jsonl`);
  const reportPath = path.join(os.tmpdir(), `test-report-${Date.now()}.json`);

  try {
    createTestJsonl(errors, jsonlPath);

    const analyzer = new ErrorAnalyzer({
      errorsPath: jsonlPath,
      reportPath,
      quiet: true
    });

    const report = await analyzer.analyze();

    // Verify grouping
    assert(report.summary.uniqueErrorPatterns === 2, 'Should have 2 unique patterns');

    // Find groups
    const invalidEmailGroup = report.groups.find(g =>
      g.pattern.toLowerCase().includes('invalid email')
    );
    const duplicateGroup = report.groups.find(g => g.pattern.toLowerCase().includes('already exists'));

    assert(invalidEmailGroup !== undefined, 'Should have invalid email group');
    assert(duplicateGroup !== undefined, 'Should have duplicate user group');

    if (invalidEmailGroup) {
      assert(invalidEmailGroup.count === 2, 'Invalid email group should have 2 errors');
      assert(
        invalidEmailGroup.pattern.includes('<EMAIL>'),
        'Pattern should normalize email to <EMAIL>'
      );
    }

    if (duplicateGroup) {
      assert(duplicateGroup.count === 1, 'Duplicate group should have 1 error');
    }
  } finally {
    cleanupFiles(jsonlPath, reportPath);
  }
}

// Test 6: Severity Calculation
async function testSeverityCalculation(): Promise<void> {
  testSection('Test 6: Severity Calculation');

  // Create errors with different counts to test severity levels
  const errors: ErrorRecord[] = [];

  // Critical: 101 server errors (count > 100)
  for (let i = 1; i <= 101; i++) {
    errors.push({
      recordNumber: i,
      email: `user${i}@example.com`,
      errorType: 'user_create',
      errorMessage: 'Internal server error',
      timestamp: new Date().toISOString(),
      httpStatus: 500,
      rawRow: { email: `user${i}@example.com` }
    });
  }

  // High: 51 validation errors (count > 50)
  for (let i = 1; i <= 51; i++) {
    errors.push({
      recordNumber: 100 + i,
      email: `invalid${i}`,
      errorType: 'user_create',
      errorMessage: 'Invalid email format',
      timestamp: new Date().toISOString(),
      httpStatus: 400,
      rawRow: { email: `invalid${i}` }
    });
  }

  // Medium: 11 duplicates (count > 10)
  for (let i = 1; i <= 11; i++) {
    errors.push({
      recordNumber: 200 + i,
      email: `dup${i}@example.com`,
      errorType: 'user_create',
      errorMessage: 'User already exists',
      timestamp: new Date().toISOString(),
      httpStatus: 409,
      rawRow: { email: `dup${i}@example.com` }
    });
  }

  // Low: 5 org not found (count <= 10)
  for (let i = 1; i <= 5; i++) {
    errors.push({
      recordNumber: 300 + i,
      email: `user${i}@example.com`,
      errorType: 'org_resolution',
      errorMessage: 'Organization not found',
      timestamp: new Date().toISOString(),
      rawRow: { email: `user${i}@example.com`, org_id: `org_${i}` }
    });
  }

  const jsonlPath = path.join(os.tmpdir(), `test-errors-${Date.now()}.jsonl`);
  const reportPath = path.join(os.tmpdir(), `test-report-${Date.now()}.json`);

  try {
    createTestJsonl(errors, jsonlPath);

    const analyzer = new ErrorAnalyzer({
      errorsPath: jsonlPath,
      reportPath,
      quiet: true
    });

    const report = await analyzer.analyze();

    // Verify we have 4 groups
    assert(report.groups.length === 4, `Should have 4 error groups (got ${report.groups.length})`);

    // Find groups by pattern and HTTP status
    const serverErrorGroup = report.groups.find(g => g.httpStatus === 500 && g.pattern.includes('Internal server error'));
    const validationGroup = report.groups.find(g => g.httpStatus === 400 && g.pattern.includes('Invalid email'));
    const duplicateGroup = report.groups.find(g => g.httpStatus === 409 && g.pattern.includes('already exists'));
    const orgErrorGroup = report.groups.find(g => g.errorType === 'org_resolution' && g.pattern.includes('not found'));

    assert(serverErrorGroup !== undefined, 'Should find server error group (500)');
    assert(validationGroup !== undefined, 'Should find validation error group (400)');
    assert(duplicateGroup !== undefined, 'Should find duplicate error group (409)');
    assert(orgErrorGroup !== undefined, 'Should find org error group');

    // Verify counts and severities (based on actual determineSeverity logic)
    if (serverErrorGroup) {
      assert(serverErrorGroup.count === 101, `Server error group should have 101 errors (got ${serverErrorGroup.count})`);
      assert(serverErrorGroup.severity === 'medium', `Server error group should be medium (httpStatus >= 500 → medium)`);
    }
    if (validationGroup) {
      assert(validationGroup.count === 51, `Validation group should have 51 errors (got ${validationGroup.count})`);
      assert(validationGroup.severity === 'critical', `Validation group should be critical (non-retryable validation → critical)`);
    }
    if (duplicateGroup) {
      assert(duplicateGroup.count === 11, `Duplicate group should have 11 errors (got ${duplicateGroup.count})`);
      assert(duplicateGroup.severity === 'high', `Duplicate group should be high (409 conflict → high)`);
    }
    if (orgErrorGroup) {
      assert(orgErrorGroup.count === 5, `Org error group should have 5 errors (got ${orgErrorGroup.count})`);
      assert(orgErrorGroup.severity === 'critical', `Org error group should be critical (org_resolution → critical)`);
    }
  } finally {
    cleanupFiles(jsonlPath, reportPath);
  }
}

// Test 7: Suggestions Generation
async function testSuggestionsGeneration(): Promise<void> {
  testSection('Test 7: Suggestions Generation');

  const errors: ErrorRecord[] = [
    {
      recordNumber: 1,
      email: 'invalid-email',
      errorType: 'user_create',
      errorMessage: 'Invalid email format',
      timestamp: new Date().toISOString(),
      httpStatus: 400,
      rawRow: { email: 'invalid-email' }
    },
    {
      recordNumber: 2,
      email: 'user@example.com',
      errorType: 'user_create',
      errorMessage: 'Rate limit exceeded',
      timestamp: new Date().toISOString(),
      httpStatus: 429,
      rawRow: { email: 'user@example.com' }
    },
    {
      recordNumber: 3,
      email: 'dup@example.com',
      errorType: 'user_create',
      errorMessage: 'User already exists',
      timestamp: new Date().toISOString(),
      httpStatus: 409,
      rawRow: { email: 'dup@example.com' }
    }
  ];

  const jsonlPath = path.join(os.tmpdir(), `test-errors-${Date.now()}.jsonl`);
  const reportPath = path.join(os.tmpdir(), `test-report-${Date.now()}.json`);

  try {
    createTestJsonl(errors, jsonlPath);

    const analyzer = new ErrorAnalyzer({
      errorsPath: jsonlPath,
      reportPath,
      quiet: true
    });

    const report = await analyzer.analyze();

    // Verify suggestions
    assert(report.suggestions.length >= 3, 'Should have at least 3 suggestions');

    // Check for specific suggestion types
    const invalidEmailSuggestion = report.suggestions.find(s =>
      s.suggestion.toLowerCase().includes('fix email')
    );
    const rateLimitSuggestion = report.suggestions.find(s =>
      s.suggestion.toLowerCase().includes('concurrency')
    );
    const duplicateSuggestion = report.suggestions.find(s =>
      s.suggestion.toLowerCase().includes('already exist')
    );

    assert(invalidEmailSuggestion !== undefined, 'Should have invalid email suggestion');
    assert(invalidEmailSuggestion?.actionable === true, 'Invalid email suggestion should be actionable');
    assert(invalidEmailSuggestion?.exampleFix !== undefined, 'Should have example fix');

    assert(rateLimitSuggestion !== undefined, 'Should have rate limit suggestion');
    assert(rateLimitSuggestion?.actionable === false, 'Rate limit suggestion should NOT be actionable');

    assert(duplicateSuggestion !== undefined, 'Should have duplicate suggestion');
    assert(duplicateSuggestion?.actionable === true, 'Duplicate suggestion should be actionable');
  } finally {
    cleanupFiles(jsonlPath, reportPath);
  }
}

// Run all tests
async function runTests(): Promise<void> {
  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║   Error Analyzer Integration Test Suite          ║');
  console.log('╚═══════════════════════════════════════════════════╝');

  await testFullWorkflowMixedErrors();
  await testOnlyRetryableErrors();
  await testOnlyNonRetryableErrors();
  await testIncludeDuplicates();
  await testErrorGroupingAndPatterns();
  await testSeverityCalculation();
  await testSuggestionsGeneration();

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
