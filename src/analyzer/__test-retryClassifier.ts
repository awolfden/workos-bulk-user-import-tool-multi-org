#!/usr/bin/env node
/**
 * Phase 4: Retry Classifier Tests
 *
 * Tests all 8 classification cases from the decision tree.
 */

import { classifyRetryability, getRetryStrategyDescription } from './retryClassifier.js';
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

// Test 1: Rate Limiting (429)
function testRateLimiting(): void {
  testSection('Test 1: Rate Limiting (429)');

  const error: ErrorRecord = {
    recordNumber: 1,
    email: 'test@example.com',
    errorType: 'user_create',
    errorMessage: 'Rate limit exceeded',
    timestamp: new Date().toISOString(),
    httpStatus: 429
  };

  const result = classifyRetryability(error);
  assert(result.retryable === true, 'Should be retryable');
  assert(result.reason === 'rate_limit', 'Reason should be rate_limit');
  assert(result.strategy?.type === 'with_backoff', 'Strategy should be with_backoff');
  assert(result.strategy?.delayMs === 5000, 'Delay should be 5000ms');
}

// Test 2: Server Errors (500+)
function testServerErrors(): void {
  testSection('Test 2: Server Errors (500+)');

  // With errorType specified - should return specific reason
  const error500: ErrorRecord = {
    recordNumber: 1,
    email: 'test@example.com',
    errorType: 'user_create',
    errorMessage: 'Internal server error',
    timestamp: new Date().toISOString(),
    httpStatus: 500
  };

  const result500 = classifyRetryability(error500);
  assert(result500.retryable === true, 'HTTP 500 should be retryable');
  assert(result500.reason === 'user_create_server_error', 'Reason should be user_create_server_error (type-specific)');
  assert(result500.strategy?.type === 'immediate', 'Strategy should be immediate');

  const error502: ErrorRecord = {
    recordNumber: 1,
    email: 'test@example.com',
    errorType: 'user_create',
    errorMessage: 'Bad gateway',
    timestamp: new Date().toISOString(),
    httpStatus: 502
  };

  const result502 = classifyRetryability(error502);
  assert(result502.retryable === true, 'HTTP 502 should be retryable');
  assert(result502.reason === 'user_create_server_error', 'Reason should be user_create_server_error (type-specific)');

  // Without errorType - should return generic reason
  const genericError: ErrorRecord = {
    recordNumber: 1,
    email: 'test@example.com',
    errorMessage: 'Service unavailable',
    timestamp: new Date().toISOString(),
    httpStatus: 503
  };

  const genericResult = classifyRetryability(genericError);
  assert(genericResult.retryable === true, 'Generic 503 should be retryable');
  assert(genericResult.reason === 'server_error', 'Reason should be server_error (generic)');
}

// Test 3: Conflict Errors (409)
function testConflictErrors(): void {
  testSection('Test 3: Conflict Errors (409)');

  // With errorType specified - should return specific reason
  const error: ErrorRecord = {
    recordNumber: 1,
    email: 'test@example.com',
    errorType: 'user_create',
    errorMessage: 'User already exists',
    timestamp: new Date().toISOString(),
    httpStatus: 409
  };

  const result = classifyRetryability(error);
  assert(result.retryable === false, 'HTTP 409 should NOT be retryable');
  assert(result.reason === 'user_create_validation_error', 'Reason should be user_create_validation_error (type-specific)');
  assert(result.strategy === undefined, 'Should have no strategy');

  // Without errorType - should return generic reason
  const genericError: ErrorRecord = {
    recordNumber: 1,
    email: 'test@example.com',
    errorMessage: 'Conflict detected',
    timestamp: new Date().toISOString(),
    httpStatus: 409
  };

  const genericResult = classifyRetryability(genericError);
  assert(genericResult.retryable === false, 'Generic 409 should NOT be retryable');
  assert(genericResult.reason === 'conflict_duplicate', 'Reason should be conflict_duplicate (generic)');
}

// Test 4: Validation Errors (400, 422)
function testValidationErrors(): void {
  testSection('Test 4: Validation Errors (400, 422)');

  // With errorType specified - should return specific reason
  const error400: ErrorRecord = {
    recordNumber: 1,
    email: 'test@example.com',
    errorType: 'user_create',
    errorMessage: 'Invalid email format',
    timestamp: new Date().toISOString(),
    httpStatus: 400
  };

  const result400 = classifyRetryability(error400);
  assert(result400.retryable === false, 'HTTP 400 should NOT be retryable');
  assert(result400.reason === 'user_create_validation_error', 'Reason should be user_create_validation_error (type-specific)');

  const error422: ErrorRecord = {
    recordNumber: 1,
    email: 'test@example.com',
    errorType: 'user_create',
    errorMessage: 'Validation failed',
    timestamp: new Date().toISOString(),
    httpStatus: 422
  };

  const result422 = classifyRetryability(error422);
  assert(result422.retryable === false, 'HTTP 422 should NOT be retryable');
  assert(result422.reason === 'user_create_validation_error', 'Reason should be user_create_validation_error (type-specific)');

  // Without errorType - should return generic reason
  const genericError400: ErrorRecord = {
    recordNumber: 1,
    email: 'test@example.com',
    errorMessage: 'Bad request',
    timestamp: new Date().toISOString(),
    httpStatus: 400
  };

  const genericResult400 = classifyRetryability(genericError400);
  assert(genericResult400.retryable === false, 'Generic 400 should NOT be retryable');
  assert(genericResult400.reason === 'validation_error', 'Reason should be validation_error (generic)');

  const genericError422: ErrorRecord = {
    recordNumber: 1,
    email: 'test@example.com',
    errorMessage: 'Unprocessable entity',
    timestamp: new Date().toISOString(),
    httpStatus: 422
  };

  const genericResult422 = classifyRetryability(genericError422);
  assert(genericResult422.retryable === false, 'Generic 422 should NOT be retryable');
  assert(genericResult422.reason === 'validation_error', 'Reason should be validation_error (generic)');
}

// Test 5: Organization Resolution Errors
function testOrgResolutionErrors(): void {
  testSection('Test 5: Organization Resolution Errors');

  // Org not found
  const notFoundError: ErrorRecord = {
    recordNumber: 1,
    email: 'test@example.com',
    errorType: 'org_resolution',
    errorMessage: 'Organization not found',
    timestamp: new Date().toISOString()
  };

  const notFoundResult = classifyRetryability(notFoundError);
  assert(notFoundResult.retryable === false, 'Org not found should NOT be retryable');
  assert(notFoundResult.reason === 'org_not_found', 'Reason should be org_not_found');

  // Org lookup error (no status)
  const lookupError: ErrorRecord = {
    recordNumber: 1,
    email: 'test@example.com',
    errorType: 'org_resolution',
    errorMessage: 'Failed to lookup organization',
    timestamp: new Date().toISOString()
  };

  const lookupResult = classifyRetryability(lookupError);
  assert(lookupResult.retryable === true, 'Org lookup error should be retryable');
  assert(lookupResult.reason === 'org_lookup_error', 'Reason should be org_lookup_error');

  // Org lookup with server error
  const serverError: ErrorRecord = {
    recordNumber: 1,
    email: 'test@example.com',
    errorType: 'org_resolution',
    errorMessage: 'Service unavailable',
    timestamp: new Date().toISOString(),
    httpStatus: 503
  };

  const serverResult = classifyRetryability(serverError);
  assert(serverResult.retryable === true, 'Org server error should be retryable');
  assert(serverResult.reason === 'org_lookup_error', 'Reason should be org_lookup_error');
}

// Test 6: Membership Creation with User Exists
function testMembershipWithUser(): void {
  testSection('Test 6: Membership Creation with User Exists');

  // User exists, membership duplicate (409)
  const duplicateError: ErrorRecord = {
    recordNumber: 1,
    email: 'test@example.com',
    userId: 'user_123',
    errorType: 'membership_create',
    errorMessage: 'Membership already exists',
    timestamp: new Date().toISOString(),
    httpStatus: 409
  };

  const duplicateResult = classifyRetryability(duplicateError);
  assert(duplicateResult.retryable === false, 'Duplicate membership should NOT be retryable');
  assert(duplicateResult.reason === 'membership_duplicate', 'Reason should be membership_duplicate');

  // User exists, membership failed (500)
  const serverError: ErrorRecord = {
    recordNumber: 1,
    email: 'test@example.com',
    userId: 'user_123',
    errorType: 'membership_create',
    errorMessage: 'Internal server error',
    timestamp: new Date().toISOString(),
    httpStatus: 500
  };

  const serverResult = classifyRetryability(serverError);
  assert(serverResult.retryable === true, 'Membership server error should be retryable');
  assert(serverResult.reason === 'membership_error_user_exists', 'Reason should be membership_error_user_exists');

  // User exists, membership validation error (400)
  const validationError: ErrorRecord = {
    recordNumber: 1,
    email: 'test@example.com',
    userId: 'user_123',
    errorType: 'membership_create',
    errorMessage: 'Invalid membership data',
    timestamp: new Date().toISOString(),
    httpStatus: 400
  };

  const validationResult = classifyRetryability(validationError);
  assert(validationResult.retryable === false, 'Membership validation error should NOT be retryable');
  assert(validationResult.reason === 'membership_validation_error', 'Reason should be membership_validation_error');
}

// Test 7: User Creation by Status Code
function testUserCreationByStatus(): void {
  testSection('Test 7: User Creation by Status Code');

  // User create server error
  const serverError: ErrorRecord = {
    recordNumber: 1,
    email: 'test@example.com',
    errorType: 'user_create',
    errorMessage: 'Service unavailable',
    timestamp: new Date().toISOString(),
    httpStatus: 503
  };

  const serverResult = classifyRetryability(serverError);
  assert(serverResult.retryable === true, 'User create server error should be retryable');
  assert(serverResult.reason === 'user_create_server_error', 'Reason should be user_create_server_error');

  // User create validation error
  const validationError: ErrorRecord = {
    recordNumber: 1,
    email: 'invalid-email',
    errorType: 'user_create',
    errorMessage: 'Invalid email',
    timestamp: new Date().toISOString(),
    httpStatus: 400
  };

  const validationResult = classifyRetryability(validationError);
  assert(validationResult.retryable === false, 'User create validation error should NOT be retryable');
  assert(validationResult.reason === 'user_create_validation_error', 'Reason should be user_create_validation_error');
}

// Test 8: Unknown Errors (no HTTP status)
function testUnknownErrors(): void {
  testSection('Test 8: Unknown Errors (no HTTP status)');

  const unknownError: ErrorRecord = {
    recordNumber: 1,
    email: 'test@example.com',
    errorType: 'user_create',
    errorMessage: 'Something went wrong',
    timestamp: new Date().toISOString()
  };

  const result = classifyRetryability(unknownError);
  assert(result.retryable === true, 'Unknown error should be retryable (conservative)');
  assert(result.reason === 'unknown_error', 'Reason should be unknown_error');
  assert(result.strategy?.type === 'immediate', 'Strategy should be immediate');
}

// Test 9: Retry Strategy Descriptions
function testRetryStrategyDescriptions(): void {
  testSection('Test 9: Retry Strategy Descriptions');

  const immediateDesc = getRetryStrategyDescription({
    type: 'immediate',
    reason: 'Test'
  });
  assert(immediateDesc === 'Retry immediately', 'Immediate strategy description should match');

  const backoffDesc = getRetryStrategyDescription({
    type: 'with_backoff',
    reason: 'Test',
    delayMs: 5000
  });
  assert(backoffDesc === 'Retry with 5000ms delay (exponential backoff recommended)', 'Backoff strategy description should match');

  const afterFixDesc = getRetryStrategyDescription({
    type: 'after_fix',
    reason: 'Test',
    fixRequired: 'Fix CSV data'
  });
  assert(afterFixDesc === 'Fix required: Fix CSV data', 'After fix strategy description should match');
}

// Run all tests
async function runTests(): Promise<void> {
  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║   Retry Classifier Test Suite                    ║');
  console.log('╚═══════════════════════════════════════════════════╝');

  testRateLimiting();
  testServerErrors();
  testConflictErrors();
  testValidationErrors();
  testOrgResolutionErrors();
  testMembershipWithUser();
  testUserCreationByStatus();
  testUnknownErrors();
  testRetryStrategyDescriptions();

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
