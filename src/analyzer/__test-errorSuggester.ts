#!/usr/bin/env node
/**
 * Phase 4: Error Suggester Tests
 *
 * Tests all 10 fix suggestion patterns.
 */

import { generateSuggestions } from './errorSuggester.js';
import type { ErrorGroup } from './types.js';
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

function createMockGroup(override: Partial<ErrorGroup>): ErrorGroup {
  return {
    id: 'test-id',
    pattern: 'Test pattern',
    count: 10,
    severity: 'medium',
    retryable: false,
    examples: [] as ErrorRecord[],
    affectedEmails: [],
    ...override
  };
}

// Test 1: Invalid Email Format
function testInvalidEmailSuggestion(): void {
  testSection('Test 1: Invalid Email Format');

  const groups: ErrorGroup[] = [
    createMockGroup({
      pattern: 'Invalid email format for <EMAIL>',
      errorType: 'user_create',
      httpStatus: 400,
      severity: 'critical'
    })
  ];

  const suggestions = generateSuggestions(groups);

  assert(suggestions.length === 1, 'Should generate 1 suggestion');
  assert(suggestions[0].actionable === true, 'Should be actionable');
  assert(suggestions[0].suggestion.includes('Fix email addresses'), 'Should suggest fixing emails');
  assert(suggestions[0].exampleFix !== undefined, 'Should have example fix');
}

// Test 2: Missing Required Field
function testMissingRequiredSuggestion(): void {
  testSection('Test 2: Missing Required Field');

  const groups: ErrorGroup[] = [
    createMockGroup({
      pattern: 'Missing required field: email',
      errorType: 'user_create',
      httpStatus: 400,
      severity: 'critical'
    })
  ];

  const suggestions = generateSuggestions(groups);

  assert(suggestions.length === 1, 'Should generate 1 suggestion');
  assert(suggestions[0].actionable === true, 'Should be actionable');
  assert(suggestions[0].suggestion.includes('Add missing required fields'), 'Should suggest adding fields');
}

// Test 3: Duplicate User
function testDuplicateUserSuggestion(): void {
  testSection('Test 3: Duplicate User');

  const groups: ErrorGroup[] = [
    createMockGroup({
      pattern: 'User <EMAIL> already exists',
      errorType: 'user_create',
      httpStatus: 409,
      severity: 'high'
    })
  ];

  const suggestions = generateSuggestions(groups);

  assert(suggestions.length === 1, 'Should generate 1 suggestion');
  assert(suggestions[0].actionable === true, 'Should be actionable');
  assert(suggestions[0].suggestion.includes('already exist'), 'Should mention users exist');
}

// Test 4: Duplicate Membership
function testDuplicateMembershipSuggestion(): void {
  testSection('Test 4: Duplicate Membership');

  const groups: ErrorGroup[] = [
    createMockGroup({
      pattern: 'Membership already exists',
      errorType: 'membership_create',
      httpStatus: 409,
      severity: 'high'
    })
  ];

  const suggestions = generateSuggestions(groups);

  assert(suggestions.length === 1, 'Should generate 1 suggestion');
  assert(suggestions[0].actionable === true, 'Should be actionable');
  assert(suggestions[0].suggestion.includes('Memberships already exist'), 'Should mention memberships exist');
}

// Test 5: Organization Not Found
function testOrgNotFoundSuggestion(): void {
  testSection('Test 5: Organization Not Found');

  const groups: ErrorGroup[] = [
    createMockGroup({
      pattern: 'Organization <ORG_ID> not found',
      errorType: 'org_resolution',
      severity: 'critical'
    })
  ];

  const suggestions = generateSuggestions(groups);

  assert(suggestions.length === 1, 'Should generate 1 suggestion');
  assert(suggestions[0].actionable === true, 'Should be actionable');
  assert(suggestions[0].suggestion.includes('not found'), 'Should mention not found');
  assert(suggestions[0].suggestion.includes('org_name'), 'Should suggest adding org_name');
}

// Test 6: Invalid JSON
function testInvalidJsonSuggestion(): void {
  testSection('Test 6: Invalid JSON');

  const groups: ErrorGroup[] = [
    createMockGroup({
      pattern: 'Invalid JSON in metadata field',
      errorType: 'user_create',
      httpStatus: 400,
      severity: 'critical'
    })
  ];

  const suggestions = generateSuggestions(groups);

  assert(suggestions.length === 1, 'Should generate 1 suggestion');
  assert(suggestions[0].actionable === true, 'Should be actionable');
  assert(suggestions[0].suggestion.includes('JSON'), 'Should mention JSON');
}

// Test 7: Password Hash Incomplete
function testPasswordHashSuggestion(): void {
  testSection('Test 7: Password Hash Incomplete');

  const groups: ErrorGroup[] = [
    createMockGroup({
      pattern: 'password_hash requires password_hash_type',
      errorType: 'user_create',
      httpStatus: 400,
      severity: 'critical'
    })
  ];

  const suggestions = generateSuggestions(groups);

  assert(suggestions.length === 1, 'Should generate 1 suggestion');
  assert(suggestions[0].actionable === true, 'Should be actionable');
  assert(suggestions[0].suggestion.includes('password_hash_type'), 'Should mention password_hash_type');
}

// Test 8: Rate Limiting
function testRateLimitingSuggestion(): void {
  testSection('Test 8: Rate Limiting');

  const groups: ErrorGroup[] = [
    createMockGroup({
      pattern: 'Rate limit exceeded',
      errorType: 'user_create',
      httpStatus: 429,
      severity: 'medium',
      retryable: true
    })
  ];

  const suggestions = generateSuggestions(groups);

  assert(suggestions.length === 1, 'Should generate 1 suggestion');
  assert(suggestions[0].actionable === false, 'Should NOT be actionable (config change)');
  assert(suggestions[0].suggestion.includes('concurrency'), 'Should mention concurrency');
}

// Test 9: Server Errors
function testServerErrorSuggestion(): void {
  testSection('Test 9: Server Errors');

  const groups: ErrorGroup[] = [
    createMockGroup({
      pattern: 'Internal server error',
      errorType: 'user_create',
      httpStatus: 500,
      severity: 'medium',
      retryable: true
    })
  ];

  const suggestions = generateSuggestions(groups);

  assert(suggestions.length === 1, 'Should generate 1 suggestion');
  assert(suggestions[0].actionable === false, 'Should NOT be actionable (wait required)');
  assert(suggestions[0].suggestion.includes('Wait'), 'Should suggest waiting');
}

// Test 10: Validation Errors
function testValidationErrorSuggestion(): void {
  testSection('Test 10: Validation Errors');

  const groups: ErrorGroup[] = [
    createMockGroup({
      pattern: 'Validation failed',
      errorType: 'user_create',
      httpStatus: 422,
      severity: 'critical'
    })
  ];

  const suggestions = generateSuggestions(groups);

  assert(suggestions.length === 1, 'Should generate 1 suggestion');
  assert(suggestions[0].actionable === true, 'Should be actionable');
  assert(suggestions[0].suggestion.includes('Validation error'), 'Should mention validation');
}

// Test 11: No Matching Pattern
function testNoMatchingPattern(): void {
  testSection('Test 11: No Matching Pattern');

  const groups: ErrorGroup[] = [
    createMockGroup({
      pattern: 'Some unknown error',
      errorType: 'unknown',
      httpStatus: 418, // I'm a teapot
      severity: 'low'
    })
  ];

  const suggestions = generateSuggestions(groups);

  assert(suggestions.length === 0, 'Should generate no suggestions for unknown patterns');
}

// Test 12: Multiple Groups
function testMultipleGroups(): void {
  testSection('Test 12: Multiple Groups');

  const groups: ErrorGroup[] = [
    createMockGroup({
      pattern: 'Invalid email format',
      errorType: 'user_create',
      httpStatus: 400
    }),
    createMockGroup({
      pattern: 'User already exists',
      errorType: 'user_create',
      httpStatus: 409
    }),
    createMockGroup({
      pattern: 'Some unknown error',
      errorType: 'unknown',
      httpStatus: 418
    })
  ];

  const suggestions = generateSuggestions(groups);

  assert(suggestions.length === 2, 'Should generate 2 suggestions (excluding unknown)');
  assert(suggestions[0].pattern.includes('Invalid email'), 'First suggestion should match first group');
  assert(suggestions[1].pattern.includes('already exists'), 'Second suggestion should match second group');
}

// Run all tests
async function runTests(): Promise<void> {
  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║   Error Suggester Test Suite                     ║');
  console.log('╚═══════════════════════════════════════════════════╝');

  testInvalidEmailSuggestion();
  testMissingRequiredSuggestion();
  testDuplicateUserSuggestion();
  testDuplicateMembershipSuggestion();
  testOrgNotFoundSuggestion();
  testInvalidJsonSuggestion();
  testPasswordHashSuggestion();
  testRateLimitingSuggestion();
  testServerErrorSuggestion();
  testValidationErrorSuggestion();
  testNoMatchingPattern();
  testMultipleGroups();

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
