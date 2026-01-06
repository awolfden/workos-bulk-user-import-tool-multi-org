#!/usr/bin/env node
/**
 * Phase 4: Error Grouper Tests
 *
 * Tests pattern normalization, grouping, and severity calculation.
 */

import { normalizeErrorMessage, generateGroupId, determineSeverity, groupErrors } from './errorGrouper.js';
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

// Test 1: Pattern Normalization - Emails
function testEmailNormalization(): void {
  testSection('Test 1: Pattern Normalization - Emails');

  const message1 = 'User test@example.com already exists';
  const normalized1 = normalizeErrorMessage(message1);
  assert(normalized1 === 'User <EMAIL> already exists', 'Should replace email with <EMAIL>');

  const message2 = 'Failed for john.doe+test@sub.domain.com';
  const normalized2 = normalizeErrorMessage(message2);
  assert(normalized2 === 'Failed for <EMAIL>', 'Should handle complex emails');

  const message3 = 'Multiple emails: a@b.com and c@d.com failed';
  const normalized3 = normalizeErrorMessage(message3);
  assert(normalized3 === 'Multiple emails: <EMAIL> and <EMAIL> failed', 'Should replace multiple emails');
}

// Test 2: Pattern Normalization - IDs
function testIdNormalization(): void {
  testSection('Test 2: Pattern Normalization - IDs');

  const message1 = 'User user_01H8G7QZXJMK2R3N4P5Q6R7S8T not found';
  const normalized1 = normalizeErrorMessage(message1);
  assert(normalized1 === 'User <USER_ID> not found', 'Should replace user ID with <USER_ID>');

  const message2 = 'Organization org_01H8G7QZXJMK2R3N4P5Q6R7S8T not found';
  const normalized2 = normalizeErrorMessage(message2);
  assert(normalized2 === 'Organization <ORG_ID> not found', 'Should replace org ID with <ORG_ID>');
}

// Test 3: Pattern Normalization - UUIDs
function testUuidNormalization(): void {
  testSection('Test 3: Pattern Normalization - UUIDs');

  const message1 = 'Request 550e8400-e29b-41d4-a716-446655440000 failed';
  const normalized1 = normalizeErrorMessage(message1);
  assert(normalized1 === 'Request <UUID> failed', 'Should replace UUID');

  const message2 = 'UUID 123e4567-e89b-12d3-a456-426614174000 invalid';
  const normalized2 = normalizeErrorMessage(message2);
  assert(normalized2 === 'UUID <UUID> invalid', 'Should replace UUID with lowercase hex');
}

// Test 4: Pattern Normalization - Numbers
function testNumberNormalization(): void {
  testSection('Test 4: Pattern Normalization - Numbers');

  const message1 = 'Failed after 12345 attempts';
  const normalized1 = normalizeErrorMessage(message1);
  assert(normalized1 === 'Failed after <NUMBER> attempts', 'Should replace large numbers');

  const message2 = 'HTTP 400 error occurred';
  const normalized2 = normalizeErrorMessage(message2);
  assert(normalized2 === 'HTTP 400 error occurred', 'Should preserve small numbers like status codes');

  const message3 = 'ID 123456789 not found';
  const normalized3 = normalizeErrorMessage(message3);
  assert(normalized3 === 'ID <NUMBER> not found', 'Should replace 5+ digit numbers');
}

// Test 5: Pattern Normalization - Whitespace
function testWhitespaceNormalization(): void {
  testSection('Test 5: Pattern Normalization - Whitespace');

  const message1 = 'User   already    exists';
  const normalized1 = normalizeErrorMessage(message1);
  assert(normalized1 === 'User already exists', 'Should normalize multiple spaces');

  const message2 = '  Error  message  ';
  const normalized2 = normalizeErrorMessage(message2);
  assert(normalized2 === 'Error message', 'Should trim leading/trailing spaces');
}

// Test 6: Group ID Generation
function testGroupIdGeneration(): void {
  testSection('Test 6: Group ID Generation');

  const id1 = generateGroupId('User <EMAIL> already exists', 'user_create', 409);
  const id2 = generateGroupId('User <EMAIL> already exists', 'user_create', 409);
  assert(id1 === id2, 'Same pattern/type/status should generate same ID');

  const id3 = generateGroupId('User <EMAIL> already exists', 'user_create', 400);
  assert(id1 !== id3, 'Different status should generate different ID');

  const id4 = generateGroupId('User <EMAIL> already exists', 'membership_create', 409);
  assert(id1 !== id4, 'Different type should generate different ID');

  assert(id1.length === 12, 'ID should be 12 characters');
}

// Test 7: Severity Determination
function testSeverityDetermination(): void {
  testSection('Test 7: Severity Determination');

  // Critical: Non-retryable validation errors
  const criticalSev1 = determineSeverity('user_create', 400, false);
  assert(criticalSev1 === 'critical', 'Non-retryable 400 should be critical');

  const criticalSev2 = determineSeverity('user_create', 422, false);
  assert(criticalSev2 === 'critical', 'Non-retryable 422 should be critical');

  // Critical: Org resolution
  const criticalSev3 = determineSeverity('org_resolution', undefined, false);
  assert(criticalSev3 === 'critical', 'Org resolution should be critical');

  // High: Conflicts
  const highSev = determineSeverity('user_create', 409, false);
  assert(highSev === 'high', '409 conflict should be high');

  // Medium: Server errors
  const mediumSev1 = determineSeverity('user_create', 500, true);
  assert(mediumSev1 === 'medium', '500 error should be medium');

  const mediumSev2 = determineSeverity('user_create', 503, true);
  assert(mediumSev2 === 'medium', '503 error should be medium');

  // Low: Everything else
  const lowSev = determineSeverity('user_create', 200, true);
  assert(lowSev === 'low', 'Other status should be low');
}

// Test 8: Error Grouping
function testErrorGrouping(): void {
  testSection('Test 8: Error Grouping');

  const errors: ErrorRecord[] = [
    {
      recordNumber: 1,
      email: 'user1@example.com',
      errorType: 'user_create',
      errorMessage: 'User user1@example.com already exists',
      timestamp: new Date().toISOString(),
      httpStatus: 409
    },
    {
      recordNumber: 2,
      email: 'user2@example.com',
      errorType: 'user_create',
      errorMessage: 'User user2@example.com already exists',
      timestamp: new Date().toISOString(),
      httpStatus: 409
    },
    {
      recordNumber: 3,
      email: 'user3@example.com',
      errorType: 'user_create',
      errorMessage: 'Invalid email format',
      timestamp: new Date().toISOString(),
      httpStatus: 400
    }
  ];

  const groups = groupErrors(errors);

  assert(groups.length === 2, 'Should create 2 groups (duplicate users and invalid email)');

  const group1 = groups.find(g => g.pattern.includes('already exists'));
  assert(group1 !== undefined, 'Should have "already exists" group');
  assert(group1!.count === 2, 'Group should have 2 errors');
  assert(group1!.affectedEmails.length === 2, 'Group should track 2 emails');

  const group2 = groups.find(g => g.pattern.includes('Invalid'));
  assert(group2 !== undefined, 'Should have "Invalid email" group');
  assert(group2!.count === 1, 'Group should have 1 error');
}

// Test 9: Group Sorting
function testGroupSorting(): void {
  testSection('Test 9: Group Sorting');

  const errors: ErrorRecord[] = [
    // Low severity (2 errors)
    {
      recordNumber: 1,
      email: 'user1@example.com',
      errorType: 'user_create',
      errorMessage: 'Some error',
      timestamp: new Date().toISOString(),
      httpStatus: 200
    },
    {
      recordNumber: 2,
      email: 'user2@example.com',
      errorType: 'user_create',
      errorMessage: 'Some error',
      timestamp: new Date().toISOString(),
      httpStatus: 200
    },
    // Critical severity (1 error)
    {
      recordNumber: 3,
      email: 'user3@example.com',
      errorType: 'org_resolution',
      errorMessage: 'Org not found',
      timestamp: new Date().toISOString()
    }
  ];

  const groups = groupErrors(errors);

  assert(groups.length === 2, 'Should create 2 groups');
  assert(groups[0].severity === 'critical', 'First group should be critical (highest severity)');
  assert(groups[0].count === 1, 'Critical group has 1 error');
  assert(groups[1].severity === 'low', 'Second group should be low');
  assert(groups[1].count === 2, 'Low group has 2 errors');
}

// Test 10: Examples and Email Limits
function testExamplesAndLimits(): void {
  testSection('Test 10: Examples and Email Limits');

  const errors: ErrorRecord[] = [];
  for (let i = 1; i <= 15; i++) {
    errors.push({
      recordNumber: i,
      email: `user${i}@example.com`,
      errorType: 'user_create',
      errorMessage: 'User already exists',
      timestamp: new Date().toISOString(),
      httpStatus: 409
    });
  }

  const groups = groupErrors(errors);

  assert(groups.length === 1, 'Should create 1 group');
  assert(groups[0].count === 15, 'Group should have 15 errors');
  assert(groups[0].examples.length === 3, 'Should include max 3 examples');
  assert(groups[0].affectedEmails.length === 10, 'Should include max 10 emails');
}

// Run all tests
async function runTests(): Promise<void> {
  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║   Error Grouper Test Suite                       ║');
  console.log('╚═══════════════════════════════════════════════════╝');

  testEmailNormalization();
  testIdNormalization();
  testUuidNormalization();
  testNumberNormalization();
  testWhitespaceNormalization();
  testGroupIdGeneration();
  testSeverityDetermination();
  testErrorGrouping();
  testGroupSorting();
  testExamplesAndLimits();

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
