#!/usr/bin/env node
/**
 * Phase 4: Error Analyzer Tests
 *
 * Tests streaming JSONL reading, classification, and report generation.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ErrorAnalyzer } from './errorAnalyzer.js';
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
 * Create a temporary JSONL file with test errors
 */
function createTestErrorsFile(errors: ErrorRecord[]): string {
  const tempDir = os.tmpdir();
  const tempFile = path.join(tempDir, `test-errors-${Date.now()}.jsonl`);

  const lines = errors.map(e => JSON.stringify(e)).join('\n');
  fs.writeFileSync(tempFile, lines);

  return tempFile;
}

/**
 * Clean up temporary file
 */
function cleanupFile(filePath: string): void {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

// Test 1: Basic Analysis
async function testBasicAnalysis(): Promise<void> {
  testSection('Test 1: Basic Analysis');

  const errors: ErrorRecord[] = [
    {
      recordNumber: 1,
      email: 'user1@example.com',
      errorType: 'user_create',
      errorMessage: 'User already exists',
      timestamp: new Date().toISOString(),
      httpStatus: 409,
      rawRow: { email: 'user1@example.com' }
    },
    {
      recordNumber: 2,
      email: 'user2@example.com',
      errorType: 'user_create',
      errorMessage: 'Internal server error',
      timestamp: new Date().toISOString(),
      httpStatus: 500,
      rawRow: { email: 'user2@example.com' }
    }
  ];

  const errorsFile = createTestErrorsFile(errors);
  const reportFile = path.join(os.tmpdir(), `test-report-${Date.now()}.json`);

  try {
    const analyzer = new ErrorAnalyzer({
      errorsPath: errorsFile,
      reportPath: reportFile,
      quiet: true
    });

    const report = await analyzer.analyze();

    assert(report.summary.totalErrors === 2, 'Should have 2 total errors');
    assert(report.summary.retryableErrors === 1, 'Should have 1 retryable error (500)');
    assert(report.summary.nonRetryableErrors === 1, 'Should have 1 non-retryable error (409)');
    assert(report.summary.uniqueEmails === 2, 'Should have 2 unique emails');
    assert(report.groups.length === 2, 'Should have 2 error groups');
    assert(fs.existsSync(reportFile), 'Report file should be created');
  } finally {
    cleanupFile(errorsFile);
    cleanupFile(reportFile);
  }
}

// Test 2: Retryability Breakdown
async function testRetryabilityBreakdown(): Promise<void> {
  testSection('Test 2: Retryability Breakdown');

  const errors: ErrorRecord[] = [
    {
      recordNumber: 1,
      email: 'user1@example.com',
      errorType: 'user_create',
      errorMessage: 'Server error',
      timestamp: new Date().toISOString(),
      httpStatus: 500,
      rawRow: { email: 'user1@example.com' }
    },
    {
      recordNumber: 2,
      email: 'user2@example.com',
      errorType: 'user_create',
      errorMessage: 'Validation error',
      timestamp: new Date().toISOString(),
      httpStatus: 400,
      rawRow: { email: 'user2@example.com' }
    },
    {
      recordNumber: 3,
      email: 'user3@example.com',
      errorType: 'user_create',
      errorMessage: 'Another server error',
      timestamp: new Date().toISOString(),
      httpStatus: 503,
      rawRow: { email: 'user3@example.com' }
    }
  ];

  const errorsFile = createTestErrorsFile(errors);
  const reportFile = path.join(os.tmpdir(), `test-report-${Date.now()}.json`);

  try {
    const analyzer = new ErrorAnalyzer({
      errorsPath: errorsFile,
      reportPath: reportFile,
      quiet: true
    });

    const report = await analyzer.analyze();

    assert(report.retryability.retryable.count === 2, 'Should have 2 retryable errors');
    assert(report.retryability.retryable.percentage === (2/3) * 100, 'Retryable percentage should be 66.67%');
    assert(report.retryability.nonRetryable.count === 1, 'Should have 1 non-retryable error');
    assert(report.retryability.nonRetryable.percentage === (1/3) * 100, 'Non-retryable percentage should be 33.33%');
  } finally {
    cleanupFile(errorsFile);
    cleanupFile(reportFile);
  }
}

// Test 3: Error Type Tracking
async function testErrorTypeTracking(): Promise<void> {
  testSection('Test 3: Error Type Tracking');

  const errors: ErrorRecord[] = [
    {
      recordNumber: 1,
      email: 'user1@example.com',
      errorType: 'user_create',
      errorMessage: 'Error 1',
      timestamp: new Date().toISOString(),
      httpStatus: 400,
      rawRow: { email: 'user1@example.com' }
    },
    {
      recordNumber: 2,
      email: 'user2@example.com',
      errorType: 'user_create',
      errorMessage: 'Error 2',
      timestamp: new Date().toISOString(),
      httpStatus: 400,
      rawRow: { email: 'user2@example.com' }
    },
    {
      recordNumber: 3,
      email: 'user3@example.com',
      errorType: 'membership_create',
      errorMessage: 'Error 3',
      timestamp: new Date().toISOString(),
      httpStatus: 500,
      rawRow: { email: 'user3@example.com' }
    },
    {
      recordNumber: 4,
      email: 'user4@example.com',
      errorType: 'org_resolution',
      errorMessage: 'Org not found',
      timestamp: new Date().toISOString(),
      rawRow: { email: 'user4@example.com' }
    }
  ];

  const errorsFile = createTestErrorsFile(errors);
  const reportFile = path.join(os.tmpdir(), `test-report-${Date.now()}.json`);

  try {
    const analyzer = new ErrorAnalyzer({
      errorsPath: errorsFile,
      reportPath: reportFile,
      quiet: true
    });

    const report = await analyzer.analyze();

    assert(report.summary.errorsByType['user_create'] === 2, 'Should have 2 user_create errors');
    assert(report.summary.errorsByType['membership_create'] === 1, 'Should have 1 membership_create error');
    assert(report.summary.errorsByType['org_resolution'] === 1, 'Should have 1 org_resolution error');
  } finally {
    cleanupFile(errorsFile);
    cleanupFile(reportFile);
  }
}

// Test 4: HTTP Status Tracking
async function testHttpStatusTracking(): Promise<void> {
  testSection('Test 4: HTTP Status Tracking');

  const errors: ErrorRecord[] = [
    {
      recordNumber: 1,
      email: 'user1@example.com',
      errorType: 'user_create',
      errorMessage: 'Error 1',
      timestamp: new Date().toISOString(),
      httpStatus: 400,
      rawRow: { email: 'user1@example.com' }
    },
    {
      recordNumber: 2,
      email: 'user2@example.com',
      errorType: 'user_create',
      errorMessage: 'Error 2',
      timestamp: new Date().toISOString(),
      httpStatus: 400,
      rawRow: { email: 'user2@example.com' }
    },
    {
      recordNumber: 3,
      email: 'user3@example.com',
      errorType: 'user_create',
      errorMessage: 'Error 3',
      timestamp: new Date().toISOString(),
      httpStatus: 409,
      rawRow: { email: 'user3@example.com' }
    },
    {
      recordNumber: 4,
      email: 'user4@example.com',
      errorType: 'user_create',
      errorMessage: 'Error 4',
      timestamp: new Date().toISOString(),
      httpStatus: 500,
      rawRow: { email: 'user4@example.com' }
    },
    {
      recordNumber: 5,
      email: 'user5@example.com',
      errorType: 'user_create',
      errorMessage: 'Error 5',
      timestamp: new Date().toISOString(),
      rawRow: { email: 'user5@example.com' }
    }
  ];

  const errorsFile = createTestErrorsFile(errors);
  const reportFile = path.join(os.tmpdir(), `test-report-${Date.now()}.json`);

  try {
    const analyzer = new ErrorAnalyzer({
      errorsPath: errorsFile,
      reportPath: reportFile,
      quiet: true
    });

    const report = await analyzer.analyze();

    assert(report.summary.errorsByStatus['400'] === 2, 'Should have 2 errors with status 400');
    assert(report.summary.errorsByStatus['409'] === 1, 'Should have 1 error with status 409');
    assert(report.summary.errorsByStatus['500'] === 1, 'Should have 1 error with status 500');
    assert(report.summary.errorsByStatus['none'] === 1, 'Should have 1 error with no status');
  } finally {
    cleanupFile(errorsFile);
    cleanupFile(reportFile);
  }
}

// Test 5: Empty File Handling
async function testEmptyFileHandling(): Promise<void> {
  testSection('Test 5: Empty File Handling');

  const errorsFile = createTestErrorsFile([]);
  const reportFile = path.join(os.tmpdir(), `test-report-${Date.now()}.json`);

  try {
    const analyzer = new ErrorAnalyzer({
      errorsPath: errorsFile,
      reportPath: reportFile,
      quiet: true
    });

    const report = await analyzer.analyze();

    assert(report.summary.totalErrors === 0, 'Should have 0 total errors');
    assert(report.summary.retryableErrors === 0, 'Should have 0 retryable errors');
    assert(report.summary.uniqueEmails === 0, 'Should have 0 unique emails');
    assert(report.groups.length === 0, 'Should have 0 error groups');
  } finally {
    cleanupFile(errorsFile);
    cleanupFile(reportFile);
  }
}

// Test 6: Retryable Errors Extraction
async function testRetryableErrorsExtraction(): Promise<void> {
  testSection('Test 6: Retryable Errors Extraction');

  const errors: ErrorRecord[] = [
    {
      recordNumber: 1,
      email: 'retryable@example.com',
      errorType: 'user_create',
      errorMessage: 'Server error',
      timestamp: new Date().toISOString(),
      httpStatus: 500,
      rawRow: { email: 'retryable@example.com', first_name: 'Test' }
    },
    {
      recordNumber: 2,
      email: 'notretryable@example.com',
      errorType: 'user_create',
      errorMessage: 'Validation error',
      timestamp: new Date().toISOString(),
      httpStatus: 400,
      rawRow: { email: 'notretryable@example.com' }
    }
  ];

  const errorsFile = createTestErrorsFile(errors);
  const reportFile = path.join(os.tmpdir(), `test-report-${Date.now()}.json`);

  try {
    const analyzer = new ErrorAnalyzer({
      errorsPath: errorsFile,
      reportPath: reportFile,
      quiet: true
    });

    await analyzer.analyze();
    const retryableErrors = analyzer.getRetryableErrors();

    assert(retryableErrors.length === 1, 'Should extract 1 retryable error');
    assert(retryableErrors[0].email === 'retryable@example.com', 'Retryable error should have correct email');
    assert(retryableErrors[0].rawRow.email === 'retryable@example.com', 'Retryable error should have rawRow data');
  } finally {
    cleanupFile(errorsFile);
    cleanupFile(reportFile);
  }
}

// Run all tests
async function runTests(): Promise<void> {
  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║   Error Analyzer Test Suite                      ║');
  console.log('╚═══════════════════════════════════════════════════╝');

  await testBasicAnalysis();
  await testRetryabilityBreakdown();
  await testErrorTypeTracking();
  await testHttpStatusTracking();
  await testEmptyFileHandling();
  await testRetryableErrorsExtraction();

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
