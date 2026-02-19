/**
 * Tests for userRoleMappingParser
 *
 * Usage: npx vitest run src/roles/__tests__/userRoleMappingParser.test.ts
 */

import { strict as assert } from 'node:assert';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { parseUserRoleMapping } from '../userRoleMappingParser.js';

const TEST_DIR = path.join(process.cwd(), '.temp-role-mapping-tests');

function setup() {
  mkdirSync(TEST_DIR, { recursive: true });
}

function cleanup() {
  rmSync(TEST_DIR, { recursive: true, force: true });
}

function writeCsv(filename: string, content: string): string {
  const filePath = path.join(TEST_DIR, filename);
  writeFileSync(filePath, content, 'utf8');
  return filePath;
}

async function runTests() {
  setup();
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

  console.log('userRoleMappingParser tests\n');

  // --- Basic parsing tests ---
  console.log('Basic parsing:');

  await test('parses valid mapping CSV', async () => {
    const csvPath = writeCsv('valid.csv',
      `external_id,role_slug
user_01,admin
user_01,editor
user_01,viewer
user_02,viewer
user_03,org-admin`
    );

    const result = await parseUserRoleMapping({ csvPath });
    assert.strictEqual(result.totalRows, 5);
    assert.strictEqual(result.uniqueUsers, 3);
    assert.strictEqual(result.uniqueRoles.size, 4);
    assert.deepStrictEqual(result.mapping.get('user_01'), ['admin', 'editor', 'viewer']);
    assert.deepStrictEqual(result.mapping.get('user_02'), ['viewer']);
    assert.deepStrictEqual(result.mapping.get('user_03'), ['org-admin']);
    assert.strictEqual(result.warnings.length, 0);
  });

  await test('groups multiple roles per user', async () => {
    const csvPath = writeCsv('multi-role.csv',
      `external_id,role_slug
user_01,admin
user_01,editor
user_01,viewer`
    );

    const result = await parseUserRoleMapping({ csvPath });
    assert.deepStrictEqual(result.mapping.get('user_01'), ['admin', 'editor', 'viewer']);
    assert.strictEqual(result.uniqueUsers, 1);
  });

  // --- Deduplication tests ---
  console.log('\nDeduplication:');

  await test('deduplicates same user+role pair with warning', async () => {
    const csvPath = writeCsv('dupe.csv',
      `external_id,role_slug
user_01,admin
user_01,admin
user_01,editor`
    );

    const result = await parseUserRoleMapping({ csvPath });
    assert.deepStrictEqual(result.mapping.get('user_01'), ['admin', 'editor']);
    assert.strictEqual(result.warnings.length, 1);
    assert.ok(result.warnings[0]!.includes('Duplicate role_slug'));
    assert.ok(result.warnings[0]!.includes('admin'));
    assert.ok(result.warnings[0]!.includes('user_01'));
  });

  // --- Validation tests ---
  console.log('\nValidation:');

  await test('skips row with missing external_id', async () => {
    const csvPath = writeCsv('no-extid.csv',
      `external_id,role_slug
,admin
user_02,viewer`
    );

    const result = await parseUserRoleMapping({ csvPath });
    assert.strictEqual(result.totalRows, 1); // Only counted valid rows
    assert.strictEqual(result.uniqueUsers, 1);
    assert.strictEqual(result.warnings.length, 1);
    assert.ok(result.warnings[0]!.includes('Missing external_id'));
  });

  await test('skips row with missing role_slug', async () => {
    const csvPath = writeCsv('no-slug.csv',
      `external_id,role_slug
user_01,
user_02,viewer`
    );

    const result = await parseUserRoleMapping({ csvPath });
    assert.strictEqual(result.totalRows, 1);
    assert.strictEqual(result.uniqueUsers, 1);
    assert.strictEqual(result.warnings.length, 1);
    assert.ok(result.warnings[0]!.includes('Missing role_slug'));
  });

  await test('throws on missing required columns', async () => {
    const csvPath = writeCsv('missing-cols.csv',
      `user_id,role
user_01,admin`
    );

    await assert.rejects(
      () => parseUserRoleMapping({ csvPath }),
      /missing required columns.*external_id.*role_slug/i
    );
  });

  await test('throws on non-existent file', async () => {
    await assert.rejects(
      () => parseUserRoleMapping({ csvPath: '/nonexistent/file.csv' }),
      /not found/
    );
  });

  // --- Edge cases ---
  console.log('\nEdge cases:');

  await test('handles single user with single role', async () => {
    const csvPath = writeCsv('single.csv',
      `external_id,role_slug
user_01,admin`
    );

    const result = await parseUserRoleMapping({ csvPath });
    assert.strictEqual(result.totalRows, 1);
    assert.strictEqual(result.uniqueUsers, 1);
    assert.deepStrictEqual(result.mapping.get('user_01'), ['admin']);
  });

  await test('trims whitespace from fields', async () => {
    const csvPath = writeCsv('whitespace.csv',
      `external_id,role_slug
  user_01  ,  admin
user_02,  viewer`
    );

    const result = await parseUserRoleMapping({ csvPath });
    assert.deepStrictEqual(result.mapping.get('user_01'), ['admin']);
    assert.deepStrictEqual(result.mapping.get('user_02'), ['viewer']);
  });

  await test('handles empty CSV (header only)', async () => {
    const csvPath = writeCsv('empty.csv',
      `external_id,role_slug`
    );

    const result = await parseUserRoleMapping({ csvPath });
    assert.strictEqual(result.totalRows, 0);
    assert.strictEqual(result.uniqueUsers, 0);
    assert.strictEqual(result.mapping.size, 0);
  });

  await test('tracks unique role slugs correctly', async () => {
    const csvPath = writeCsv('roles.csv',
      `external_id,role_slug
user_01,admin
user_02,admin
user_03,editor
user_04,viewer`
    );

    const result = await parseUserRoleMapping({ csvPath });
    assert.strictEqual(result.uniqueRoles.size, 3);
    assert.ok(result.uniqueRoles.has('admin'));
    assert.ok(result.uniqueRoles.has('editor'));
    assert.ok(result.uniqueRoles.has('viewer'));
  });

  // Summary
  cleanup();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
