#!/usr/bin/env node
/**
 * Phase 4: Retry CSV Generator Tests
 *
 * Tests deduplication, column ordering, and CSV generation.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parse } from 'csv-parse/sync';
import { generateRetryCsv } from './retryCsvGenerator.js';
import type { RetryableError } from './types.js';
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
 * Read CSV file and parse it
 */
function readCsv(filePath: string): Record<string, unknown>[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  return parse(content, { columns: true, skip_empty_lines: true });
}

/**
 * Clean up temporary file
 */
function cleanupFile(filePath: string): void {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

// Test 1: Basic CSV Generation
async function testBasicCsvGeneration(): Promise<void> {
  testSection('Test 1: Basic CSV Generation');

  const retryableErrors: RetryableError[] = [
    {
      email: 'user1@example.com',
      rawRow: {
        email: 'user1@example.com',
        first_name: 'User',
        last_name: 'One'
      },
      errorRecord: {} as ErrorRecord
    },
    {
      email: 'user2@example.com',
      rawRow: {
        email: 'user2@example.com',
        first_name: 'User',
        last_name: 'Two'
      },
      errorRecord: {} as ErrorRecord
    }
  ];

  const outputPath = path.join(os.tmpdir(), `test-retry-${Date.now()}.csv`);

  try {
    await generateRetryCsv(retryableErrors, outputPath, false);

    assert(fs.existsSync(outputPath), 'CSV file should be created');

    const rows = readCsv(outputPath);
    assert(rows.length === 2, 'Should have 2 rows');
    assert(rows[0].email === 'user1@example.com', 'First row should have correct email');
    assert(rows[1].email === 'user2@example.com', 'Second row should have correct email');
  } finally {
    cleanupFile(outputPath);
  }
}

// Test 2: Deduplication by Email
async function testDeduplication(): Promise<void> {
  testSection('Test 2: Deduplication by Email');

  const retryableErrors: RetryableError[] = [
    {
      email: 'user@example.com',
      rawRow: {
        email: 'user@example.com',
        first_name: 'First',
        last_name: 'Attempt'
      },
      errorRecord: {} as ErrorRecord
    },
    {
      email: 'USER@EXAMPLE.COM', // Same email, different case
      rawRow: {
        email: 'USER@EXAMPLE.COM',
        first_name: 'Second',
        last_name: 'Attempt'
      },
      errorRecord: {} as ErrorRecord
    },
    {
      email: 'other@example.com',
      rawRow: {
        email: 'other@example.com',
        first_name: 'Other',
        last_name: 'User'
      },
      errorRecord: {} as ErrorRecord
    }
  ];

  const outputPath = path.join(os.tmpdir(), `test-retry-${Date.now()}.csv`);

  try {
    await generateRetryCsv(retryableErrors, outputPath, false);

    const rows = readCsv(outputPath);
    assert(rows.length === 2, 'Should deduplicate to 2 unique emails');
    assert(rows[0].first_name === 'First', 'Should keep first occurrence (First Attempt)');
  } finally {
    cleanupFile(outputPath);
  }
}

// Test 3: Include Duplicates Option
async function testIncludeDuplicates(): Promise<void> {
  testSection('Test 3: Include Duplicates Option');

  const retryableErrors: RetryableError[] = [
    {
      email: 'user@example.com',
      rawRow: {
        email: 'user@example.com',
        first_name: 'First'
      },
      errorRecord: {} as ErrorRecord
    },
    {
      email: 'user@example.com',
      rawRow: {
        email: 'user@example.com',
        first_name: 'Second'
      },
      errorRecord: {} as ErrorRecord
    }
  ];

  const outputPath = path.join(os.tmpdir(), `test-retry-${Date.now()}.csv`);

  try {
    await generateRetryCsv(retryableErrors, outputPath, true);

    const rows = readCsv(outputPath);
    assert(rows.length === 2, 'Should include both duplicates when includeDuplicates=true');
  } finally {
    cleanupFile(outputPath);
  }
}

// Test 4: Column Ordering
async function testColumnOrdering(): Promise<void> {
  testSection('Test 4: Column Ordering');

  const retryableErrors: RetryableError[] = [
    {
      email: 'user@example.com',
      rawRow: {
        custom_field: 'value',
        email: 'user@example.com',
        first_name: 'User',
        external_id: 'ext123',
        another_custom: 'data'
      },
      errorRecord: {} as ErrorRecord
    }
  ];

  const outputPath = path.join(os.tmpdir(), `test-retry-${Date.now()}.csv`);

  try {
    await generateRetryCsv(retryableErrors, outputPath, false);

    // Read raw CSV to check column order
    const content = fs.readFileSync(outputPath, 'utf-8');
    const headerLine = content.split('\n')[0];
    const columns = headerLine.split(',');

    // Standard columns should come first
    const emailIndex = columns.indexOf('email');
    const firstNameIndex = columns.indexOf('first_name');
    const externalIdIndex = columns.indexOf('external_id');

    assert(emailIndex === 0, 'email should be first column');
    assert(firstNameIndex >= 0 && firstNameIndex < columns.length - 2, 'first_name should be in standard columns');
    assert(externalIdIndex >= 0 && externalIdIndex < columns.length - 2, 'external_id should be in standard columns');

    // Custom columns should come after standard ones
    const customFieldIndex = columns.indexOf('custom_field');
    const anotherCustomIndex = columns.indexOf('another_custom');

    assert(customFieldIndex > externalIdIndex, 'custom_field should come after standard columns');
    assert(anotherCustomIndex > externalIdIndex, 'another_custom should come after standard columns');
  } finally {
    cleanupFile(outputPath);
  }
}

// Test 5: Empty Errors Handling
async function testEmptyErrors(): Promise<void> {
  testSection('Test 5: Empty Errors Handling');

  const retryableErrors: RetryableError[] = [];
  const outputPath = path.join(os.tmpdir(), `test-retry-${Date.now()}.csv`);

  try {
    let errorThrown = false;
    try {
      await generateRetryCsv(retryableErrors, outputPath, false);
    } catch (err) {
      errorThrown = true;
      assert(err instanceof Error && err.message.includes('No retryable errors'), 'Should throw error for empty errors');
    }

    assert(errorThrown, 'Should throw error when no retryable errors');
  } finally {
    cleanupFile(outputPath);
  }
}

// Test 6: All Standard Columns
async function testAllStandardColumns(): Promise<void> {
  testSection('Test 6: All Standard Columns');

  const retryableErrors: RetryableError[] = [
    {
      email: 'user@example.com',
      rawRow: {
        email: 'user@example.com',
        password: 'hashed',
        password_hash: 'hash123',
        password_hash_type: 'bcrypt',
        first_name: 'User',
        last_name: 'Test',
        email_verified: true,
        external_id: 'ext123',
        metadata: '{"key":"value"}',
        org_id: 'org_123',
        org_external_id: 'ext_org',
        org_name: 'Test Org'
      },
      errorRecord: {} as ErrorRecord
    }
  ];

  const outputPath = path.join(os.tmpdir(), `test-retry-${Date.now()}.csv`);

  try {
    await generateRetryCsv(retryableErrors, outputPath, false);

    const rows = readCsv(outputPath);
    assert(rows.length === 1, 'Should have 1 row');
    assert(rows[0].email === 'user@example.com', 'Should have email');
    assert(rows[0].first_name === 'User', 'Should have first_name');
    assert(rows[0].org_name === 'Test Org', 'Should have org_name');
  } finally {
    cleanupFile(outputPath);
  }
}

// Run all tests
async function runTests(): Promise<void> {
  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║   Retry CSV Generator Test Suite                 ║');
  console.log('╚═══════════════════════════════════════════════════╝');

  await testBasicCsvGeneration();
  await testDeduplication();
  await testIncludeDuplicates();
  await testColumnOrdering();
  await testEmptyErrors();
  await testAllStandardColumns();

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
