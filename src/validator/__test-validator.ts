#!/usr/bin/env node
/**
 * Phase 2: CSV Validator Tests
 *
 * Comprehensive tests for validator components:
 * - DuplicateDetector
 * - Validation rules
 * - CSVValidator (integration)
 * - Auto-fix functionality
 * - CLI behavior
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DuplicateDetector } from './duplicateDetector.js';
import { HEADER_RULES, ROW_RULES, getAutoFixRules, getRuleById } from './rules.js';
import { CSVValidator } from './csvValidator.js';
import type { ValidationOptions } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const examplesDir = path.join(__dirname, '../../examples');

let testsRun = 0;
let testsPassed = 0;
let testsFailed = 0;

/**
 * Test assertion helper
 */
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

/**
 * Test section header
 */
function testSection(name: string): void {
  console.log(`\n${name}`);
  console.log('='.repeat(name.length));
}

/**
 * Test 1: DuplicateDetector
 */
function testDuplicateDetector(): void {
  testSection('Test 1: DuplicateDetector');

  const detector = new DuplicateDetector();

  // Test email tracking
  assert(!detector.hasEmail('alice@example.com'), 'First email should not be duplicate');
  detector.addEmail('alice@example.com');
  assert(detector.hasEmail('alice@example.com'), 'Second email should be duplicate');

  // Test email normalization (case insensitive)
  assert(detector.hasEmail('ALICE@EXAMPLE.COM'), 'Email should be case-insensitive');
  assert(detector.hasEmail(' alice@example.com '), 'Email should trim whitespace');

  // Test external_id tracking
  assert(!detector.hasExternalId('user-001'), 'First external_id should not be duplicate');
  detector.addExternalId('user-001');
  assert(detector.hasExternalId('user-001'), 'Second external_id should be duplicate');

  // Test stats
  const stats = detector.getStats();
  assert(stats.emails === 1, `Should have 1 unique email (got ${stats.emails})`);
  assert(stats.externalIds === 1, `Should have 1 unique external_id (got ${stats.externalIds})`);
  assert(stats.memoryMB >= 0, 'Memory usage should be calculated');

  // Test reset
  detector.reset();
  const emptyStats = detector.getStats();
  assert(emptyStats.emails === 0, 'After reset, emails should be 0');
  assert(emptyStats.externalIds === 0, 'After reset, external_ids should be 0');
}

/**
 * Test 2: Validation Rules
 */
function testValidationRules(): void {
  testSection('Test 2: Validation Rules');

  // Test header rules
  assert(HEADER_RULES.length === 3, `Should have 3 header rules (got ${HEADER_RULES.length})`);

  const requiredEmailRule = getRuleById('required-email-column');
  assert(requiredEmailRule !== undefined, 'Should find required-email-column rule');

  // Test missing email column
  const missingEmailIssues = requiredEmailRule!.validate({ headers: ['first_name', 'last_name'] });
  assert(missingEmailIssues.length === 1, 'Should detect missing email column');
  assert(missingEmailIssues[0].severity === 'error', 'Missing email should be an error');

  // Test valid headers
  const validHeaderIssues = requiredEmailRule!.validate({ headers: ['email', 'first_name'] });
  assert(validHeaderIssues.length === 0, 'Should pass with email column present');

  // Test row rules
  assert(ROW_RULES.length === 7, `Should have 7 row rules (got ${ROW_RULES.length})`);

  const requiredEmailRowRule = getRuleById('required-email');
  assert(requiredEmailRowRule !== undefined, 'Should find required-email rule');

  // Test missing email in row
  const missingEmailRowIssues = requiredEmailRowRule!.validate({
    row: { first_name: 'Alice' },
    recordNumber: 1
  });
  assert(missingEmailRowIssues.length === 1, 'Should detect missing email in row');

  // Test valid email in row
  const validEmailRowIssues = requiredEmailRowRule!.validate({
    row: { email: 'alice@example.com' },
    recordNumber: 1
  });
  assert(validEmailRowIssues.length === 0, 'Should pass with email present');

  // Test email format rule
  const emailFormatRule = getRuleById('email-format');
  assert(emailFormatRule !== undefined, 'Should find email-format rule');

  const invalidEmailIssues = emailFormatRule!.validate({
    row: { email: 'not-an-email' },
    recordNumber: 1
  });
  assert(invalidEmailIssues.length === 1, 'Should detect invalid email format');

  const validEmailFormatIssues = emailFormatRule!.validate({
    row: { email: 'alice@example.com' },
    recordNumber: 1
  });
  assert(validEmailFormatIssues.length === 0, 'Should pass with valid email format');
}

/**
 * Test 3: Auto-fix Rules
 */
function testAutoFixRules(): void {
  testSection('Test 3: Auto-fix Rules');

  const autoFixRules = getAutoFixRules();
  assert(autoFixRules.length === 2, `Should have 2 auto-fix rules (got ${autoFixRules.length})`);

  // Test email whitespace auto-fix
  const emailWhitespaceRule = getRuleById('email-whitespace');
  assert(emailWhitespaceRule !== undefined, 'Should find email-whitespace rule');
  assert(emailWhitespaceRule!.autofix !== undefined, 'email-whitespace should have autofix');

  const { fixed: fixedEmail, changes: emailChanges } = emailWhitespaceRule!.autofix!({
    email: '  alice@example.com  '
  });
  assert(fixedEmail.email === 'alice@example.com', 'Should trim email whitespace');
  assert(emailChanges.length === 1, 'Should record one change');
  assert(emailChanges[0].field === 'email', 'Change should be for email field');

  // Test boolean format auto-fix
  const booleanFormatRule = getRuleById('boolean-format');
  assert(booleanFormatRule !== undefined, 'Should find boolean-format rule');
  assert(booleanFormatRule!.autofix !== undefined, 'boolean-format should have autofix');

  const { fixed: fixedBoolean, changes: booleanChanges } = booleanFormatRule!.autofix!({
    email_verified: 'yes'
  });
  assert(fixedBoolean.email_verified === 'true', 'Should normalize "yes" to "true"');
  assert(booleanChanges.length === 1, 'Should record one change');

  const { fixed: fixedNo, changes: noChanges } = booleanFormatRule!.autofix!({
    email_verified: 'no'
  });
  assert(fixedNo.email_verified === 'false', 'Should normalize "no" to "false"');
  assert(noChanges.length === 1, 'Should record change for "no"');

  const { fixed: fixedOne, changes: oneChanges } = booleanFormatRule!.autofix!({
    email_verified: '1'
  });
  assert(fixedOne.email_verified === 'true', 'Should normalize "1" to "true"');
  assert(oneChanges.length === 1, 'Should record change for "1"');
}

/**
 * Test 4: CSVValidator Integration (Valid CSV)
 */
async function testValidCSV(): Promise<void> {
  testSection('Test 4: CSVValidator Integration (Valid CSV)');

  const csvPath = path.join(examplesDir, 'validation-test-valid.csv');
  const reportPath = path.join(examplesDir, '__test-report-valid.json');

  const options: ValidationOptions = {
    csvPath,
    reportPath,
    quiet: true
  };

  try {
    const validator = new CSVValidator(options);
    const report = await validator.validate();

    assert(report.summary.totalRows === 3, `Should have 3 rows (got ${report.summary.totalRows})`);
    assert(report.summary.validRows === 3, `Should have 3 valid rows (got ${report.summary.validRows})`);
    assert(report.summary.invalidRows === 0, `Should have 0 invalid rows (got ${report.summary.invalidRows})`);
    assert(report.summary.mode === 'multi-org', `Should detect multi-org mode (got ${report.summary.mode})`);

    const errorCount = report.issues.filter(i => i.severity === 'error').length;
    assert(errorCount === 0, `Should have 0 errors (got ${errorCount})`);

    // Cleanup
    if (fs.existsSync(reportPath)) {
      fs.unlinkSync(reportPath);
    }
  } catch (err) {
    assert(false, `Valid CSV test failed: ${err}`);
  }
}

/**
 * Test 5: CSVValidator Integration (Error CSV)
 */
async function testErrorCSV(): Promise<void> {
  testSection('Test 5: CSVValidator Integration (Error CSV)');

  const csvPath = path.join(examplesDir, 'validation-test-errors.csv');
  const reportPath = path.join(examplesDir, '__test-report-errors.json');

  const options: ValidationOptions = {
    csvPath,
    reportPath,
    quiet: true
  };

  try {
    const validator = new CSVValidator(options);
    const report = await validator.validate();

    assert(report.summary.totalRows === 5, `Should have 5 rows (got ${report.summary.totalRows})`);
    assert(report.summary.invalidRows === 5, `Should have 5 invalid rows (got ${report.summary.invalidRows})`);

    const errorCount = report.issues.filter(i => i.severity === 'error').length;
    assert(errorCount === 5, `Should have 5 errors (got ${errorCount})`);

    // Check specific errors
    const missingEmailError = report.issues.find(i => i.ruleId === 'required-email');
    assert(missingEmailError !== undefined, 'Should detect missing email error');

    const invalidEmailError = report.issues.find(i => i.ruleId === 'email-format');
    assert(invalidEmailError !== undefined, 'Should detect invalid email format error');

    const invalidJsonError = report.issues.find(i => i.ruleId === 'metadata-json');
    assert(invalidJsonError !== undefined, 'Should detect invalid JSON error');

    const orgConflictError = report.issues.find(i => i.ruleId === 'org-id-conflict');
    assert(orgConflictError !== undefined, 'Should detect org_id conflict error');

    const passwordHashError = report.issues.find(i => i.ruleId === 'password-hash-complete');
    assert(passwordHashError !== undefined, 'Should detect incomplete password hash error');

    // Cleanup
    if (fs.existsSync(reportPath)) {
      fs.unlinkSync(reportPath);
    }
  } catch (err) {
    assert(false, `Error CSV test failed: ${err}`);
  }
}

/**
 * Test 6: CSVValidator Auto-fix
 */
async function testAutoFix(): Promise<void> {
  testSection('Test 6: CSVValidator Auto-fix');

  const csvPath = path.join(examplesDir, 'validation-test-autofix.csv');
  const fixedCsvPath = path.join(examplesDir, '__test-fixed.csv');
  const reportPath = path.join(examplesDir, '__test-report-autofix.json');

  const options: ValidationOptions = {
    csvPath,
    autoFix: true,
    fixedCsvPath,
    reportPath,
    quiet: true
  };

  try {
    const validator = new CSVValidator(options);
    const report = await validator.validate();

    assert(report.summary.autoFixApplied === true, 'Auto-fix should be applied');
    assert(report.summary.fixedIssues === 3, `Should fix 3 issues (got ${report.summary.fixedIssues})`);
    assert(report.summary.validRows === 3, `All rows should be valid after auto-fix (got ${report.summary.validRows})`);

    // Check that fixed CSV exists
    assert(fs.existsSync(fixedCsvPath), 'Fixed CSV should exist');

    // Read fixed CSV and verify fixes
    const fixedContent = fs.readFileSync(fixedCsvPath, 'utf-8');
    const lines = fixedContent.trim().split('\n');
    assert(lines.length === 4, `Fixed CSV should have 4 lines (header + 3 rows), got ${lines.length}`);

    // Check that email whitespace was removed
    assert(lines[1].startsWith('alice@example.com,'), 'First row should have trimmed email');
    assert(lines[2].startsWith('bob@example.com,'), 'Second row should have trimmed email');

    // Check that booleans were normalized
    assert(lines[1].includes(',true,'), 'First row should have normalized boolean (yes → true)');
    assert(lines[2].includes(',true,'), 'Second row should have normalized boolean (1 → true)');
    assert(lines[3].includes(',false,'), 'Third row should have normalized boolean (no → false)');

    // Cleanup
    if (fs.existsSync(fixedCsvPath)) {
      fs.unlinkSync(fixedCsvPath);
    }
    if (fs.existsSync(reportPath)) {
      fs.unlinkSync(reportPath);
    }
  } catch (err) {
    assert(false, `Auto-fix test failed: ${err}`);
  }
}

/**
 * Run all tests
 */
async function runTests(): Promise<void> {
  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║   CSV Validator Test Suite                       ║');
  console.log('╚═══════════════════════════════════════════════════╝');

  // Unit tests
  testDuplicateDetector();
  testValidationRules();
  testAutoFixRules();

  // Integration tests
  await testValidCSV();
  await testErrorCSV();
  await testAutoFix();

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
