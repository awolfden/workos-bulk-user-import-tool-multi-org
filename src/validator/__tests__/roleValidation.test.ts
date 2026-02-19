/**
 * Tests for role_slugs validation rules
 *
 * Usage: npx vitest run src/validator/__tests__/roleValidation.test.ts
 */

import { strict as assert } from 'node:assert';

async function runTests() {
  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void> | void) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err: any) {
      console.log(`  ✗ ${name}`);
      console.log(`    ${err.message}`);
      failed++;
    }
  }

  console.log('Role Validation Rules tests\n');

  const { ROW_RULES } = await import('../rules.js');

  // Find the role-slugs-format rule
  const roleSlugsRule = ROW_RULES.find(r => r.id === 'role-slugs-format');
  assert.ok(roleSlugsRule, 'role-slugs-format rule should exist');

  // --- Valid formats ---
  console.log('Valid formats:');

  await test('valid comma-separated slugs pass', () => {
    const issues = roleSlugsRule!.validate({
      row: { email: 'test@example.com', role_slugs: 'admin,editor,viewer' },
      recordNumber: 1,
    });
    assert.strictEqual(issues.length, 0);
  });

  await test('valid JSON array slugs pass', () => {
    const issues = roleSlugsRule!.validate({
      row: { email: 'test@example.com', role_slugs: '["admin","editor"]' },
      recordNumber: 1,
    });
    assert.strictEqual(issues.length, 0);
  });

  await test('single slug passes', () => {
    const issues = roleSlugsRule!.validate({
      row: { email: 'test@example.com', role_slugs: 'admin' },
      recordNumber: 1,
    });
    assert.strictEqual(issues.length, 0);
  });

  await test('slugs with hyphens and underscores pass', () => {
    const issues = roleSlugsRule!.validate({
      row: { email: 'test@example.com', role_slugs: 'org-admin,content_editor' },
      recordNumber: 1,
    });
    assert.strictEqual(issues.length, 0);
  });

  await test('no role_slugs column returns no issues', () => {
    const issues = roleSlugsRule!.validate({
      row: { email: 'test@example.com' },
      recordNumber: 1,
    });
    assert.strictEqual(issues.length, 0);
  });

  // --- Invalid formats ---
  console.log('\nInvalid formats:');

  await test('uppercase slug produces error', () => {
    const issues = roleSlugsRule!.validate({
      row: { email: 'test@example.com', role_slugs: 'Admin' },
      recordNumber: 1,
    });
    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0]!.severity, 'error');
    assert.ok(issues[0]!.message.includes('Admin'));
  });

  await test('slug with spaces produces error', () => {
    const issues = roleSlugsRule!.validate({
      row: { email: 'test@example.com', role_slugs: 'org admin' },
      recordNumber: 1,
    });
    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0]!.severity, 'error');
  });

  await test('slug with special characters produces error', () => {
    const issues = roleSlugsRule!.validate({
      row: { email: 'test@example.com', role_slugs: 'editor@v2' },
      recordNumber: 1,
    });
    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0]!.severity, 'error');
  });

  await test('multiple invalid slugs produce multiple errors', () => {
    const issues = roleSlugsRule!.validate({
      row: { email: 'test@example.com', role_slugs: 'Admin,org admin' },
      recordNumber: 1,
    });
    assert.strictEqual(issues.length, 2);
  });

  // --- Edge cases ---
  console.log('\nEdge cases:');

  await test('empty role_slugs produces warning', () => {
    const issues = roleSlugsRule!.validate({
      row: { email: 'test@example.com', role_slugs: '' },
      recordNumber: 1,
    });
    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0]!.severity, 'warning');
    assert.ok(issues[0]!.message.includes('empty'));
  });

  await test('whitespace-only role_slugs produces warning', () => {
    const issues = roleSlugsRule!.validate({
      row: { email: 'test@example.com', role_slugs: '   ' },
      recordNumber: 1,
    });
    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0]!.severity, 'warning');
  });

  await test('mix of valid and invalid slugs reports only invalid', () => {
    const issues = roleSlugsRule!.validate({
      row: { email: 'test@example.com', role_slugs: 'admin,Bad Slug,viewer' },
      recordNumber: 1,
    });
    assert.strictEqual(issues.length, 1);
    assert.ok(issues[0]!.message.includes('Bad Slug'));
  });

  // Summary
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
