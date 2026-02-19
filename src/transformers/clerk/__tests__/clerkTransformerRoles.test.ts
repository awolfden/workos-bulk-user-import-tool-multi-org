/**
 * Tests for Clerk transformer role mapping integration
 *
 * Usage: npx vitest run src/transformers/clerk/__tests__/clerkTransformerRoles.test.ts
 */

import { strict as assert } from 'node:assert';
import { writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import path from 'node:path';

const TEST_DIR = path.join(process.cwd(), '.temp-clerk-role-tests');

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

  console.log('Clerk Transformer Roles tests\n');

  // --- loadRoleMapping tests ---
  console.log('loadRoleMapping:');

  await test('loads role mapping CSV keyed by clerk_user_id', async () => {
    const { loadRoleMapping } = await import('../clerkTransformer.js');

    const csvPath = writeCsv('role-mapping.csv',
      `clerk_user_id,role_slug
user_01,admin
user_01,editor
user_02,viewer
user_03,org-admin`
    );

    const result = await loadRoleMapping(csvPath, true);
    assert.strictEqual(result.size, 3);
    assert.deepStrictEqual(result.get('user_01'), ['admin', 'editor']);
    assert.deepStrictEqual(result.get('user_02'), ['viewer']);
    assert.deepStrictEqual(result.get('user_03'), ['org-admin']);
  });

  await test('accepts external_id as join key', async () => {
    const { loadRoleMapping } = await import('../clerkTransformer.js');

    const csvPath = writeCsv('role-mapping-extid.csv',
      `external_id,role_slug
user_01,admin
user_02,viewer`
    );

    const result = await loadRoleMapping(csvPath, true);
    assert.strictEqual(result.size, 2);
    assert.deepStrictEqual(result.get('user_01'), ['admin']);
  });

  await test('deduplicates same user+role pair', async () => {
    const { loadRoleMapping } = await import('../clerkTransformer.js');

    const csvPath = writeCsv('role-mapping-dupe.csv',
      `clerk_user_id,role_slug
user_01,admin
user_01,admin
user_01,editor`
    );

    const result = await loadRoleMapping(csvPath, true);
    assert.deepStrictEqual(result.get('user_01'), ['admin', 'editor']);
  });

  await test('throws on missing required columns', async () => {
    const { loadRoleMapping } = await import('../clerkTransformer.js');

    const csvPath = writeCsv('role-mapping-bad.csv',
      `user_id,role
user_01,admin`
    );

    await assert.rejects(
      () => loadRoleMapping(csvPath, true),
      /clerk_user_id.*external_id/
    );
  });

  await test('throws on non-existent file', async () => {
    const { loadRoleMapping } = await import('../clerkTransformer.js');

    await assert.rejects(
      () => loadRoleMapping('/nonexistent/file.csv', true),
      /not found/
    );
  });

  // --- Transform integration ---
  console.log('\nTransform with role mapping:');

  await test('transformClerkExport merges role slugs into output', async () => {
    const { transformClerkExport } = await import('../clerkTransformer.js');

    const clerkCsv = writeCsv('clerk-users.csv',
      `id,first_name,last_name,primary_email_address,password_digest,password_hasher
user_01,Alice,Smith,alice@example.com,$2a$10$abcdef,bcrypt
user_02,Bob,Jones,bob@example.com,$2a$10$ghijkl,bcrypt
user_03,Charlie,Brown,charlie@example.com,,`
    );

    const roleMappingCsv = writeCsv('roles.csv',
      `clerk_user_id,role_slug
user_01,admin
user_01,editor
user_02,viewer`
    );

    const outputPath = path.join(TEST_DIR, 'output.csv');

    const summary = await transformClerkExport({
      clerkCsvPath: clerkCsv,
      outputPath,
      roleMappingPath: roleMappingCsv,
      quiet: true,
    });

    assert.strictEqual(summary.usersWithRoleMapping, 2);
    assert.strictEqual(summary.transformedUsers, 3);

    // Verify output CSV contains role_slugs column
    const output = readFileSync(outputPath, 'utf8');
    const lines = output.trim().split('\n');
    const headers = lines[0]!.split(',');
    assert.ok(headers.includes('role_slugs'), 'Output should have role_slugs column');

    // Verify role slugs are in the data rows
    assert.ok(output.includes('admin,editor') || output.includes('"admin,editor"'),
      'Output should contain merged role slugs for user_01');
  });

  await test('transformClerkExport handles users with no role mapping', async () => {
    const { transformClerkExport } = await import('../clerkTransformer.js');

    const clerkCsv = writeCsv('clerk-no-roles.csv',
      `id,first_name,last_name,primary_email_address,password_digest,password_hasher
user_01,Alice,Smith,alice@example.com,,
user_02,Bob,Jones,bob@example.com,,`
    );

    const roleMappingCsv = writeCsv('roles-partial.csv',
      `clerk_user_id,role_slug
user_99,admin`
    );

    const outputPath = path.join(TEST_DIR, 'output-no-match.csv');

    const summary = await transformClerkExport({
      clerkCsvPath: clerkCsv,
      outputPath,
      roleMappingPath: roleMappingCsv,
      quiet: true,
    });

    assert.strictEqual(summary.usersWithRoleMapping, 0);
    assert.strictEqual(summary.transformedUsers, 2);
  });

  await test('transformClerkExport without role mapping omits role_slugs column', async () => {
    const { transformClerkExport } = await import('../clerkTransformer.js');

    const clerkCsv = writeCsv('clerk-no-role-flag.csv',
      `id,first_name,last_name,primary_email_address,password_digest,password_hasher
user_01,Alice,Smith,alice@example.com,,`
    );

    const outputPath = path.join(TEST_DIR, 'output-no-role-flag.csv');

    const summary = await transformClerkExport({
      clerkCsvPath: clerkCsv,
      outputPath,
      quiet: true,
    });

    assert.strictEqual(summary.usersWithRoleMapping, 0);

    const output = readFileSync(outputPath, 'utf8');
    const headers = output.trim().split('\n')[0]!.split(',');
    assert.ok(!headers.includes('role_slugs'), 'Output should not have role_slugs column without role mapping');
  });

  // Summary
  cleanup();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
