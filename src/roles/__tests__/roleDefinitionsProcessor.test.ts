/**
 * Tests for roleDefinitionsProcessor
 *
 * Usage: npx tsx src/roles/__tests__/roleDefinitionsProcessor.test.ts
 */

import { strict as assert } from 'node:assert';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { RoleCache } from '../roleCache.js';
import { processRoleDefinitions } from '../roleDefinitionsProcessor.js';

const TEST_DIR = path.join(process.cwd(), '.temp-role-processor-tests');

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

  console.log('roleDefinitionsProcessor tests\n');

  // --- Dry-run tests (no API calls) ---
  console.log('Dry-run mode:');

  await test('processes environment roles in dry-run (creates)', async () => {
    const csvPath = writeCsv('env-roles.csv',
      `role_slug,role_name,role_type,permissions,org_id,org_external_id
admin,Administrator,environment,"users:manage,billing:manage",,
viewer,Viewer,environment,"posts:read",,`
    );

    const roleCache = new RoleCache({ dryRun: true });
    const summary = await processRoleDefinitions({
      csvPath,
      roleCache,
      dryRun: true,
      quiet: true,
    });

    assert.strictEqual(summary.total, 2);
    assert.strictEqual(summary.created, 2);
    assert.strictEqual(summary.errors, 0);
  });

  await test('detects existing environment roles', async () => {
    const csvPath = writeCsv('existing-env.csv',
      `role_slug,role_name,role_type,permissions,org_id,org_external_id
admin,Administrator,environment,"users:manage",,`
    );

    // Pre-populate cache with existing role
    const roleCache = new RoleCache({ dryRun: true });
    roleCache.set({
      slug: 'admin',
      id: 'role_existing',
      name: 'Administrator',
      permissions: ['users:manage'],
      type: 'EnvironmentRole',
      cachedAt: Date.now(),
    });

    const summary = await processRoleDefinitions({
      csvPath,
      roleCache,
      dryRun: true,
      quiet: true,
    });

    assert.strictEqual(summary.total, 1);
    assert.strictEqual(summary.alreadyExist, 1);
    assert.strictEqual(summary.created, 0);
  });

  await test('detects permission mismatch on existing role', async () => {
    const csvPath = writeCsv('perm-mismatch.csv',
      `role_slug,role_name,role_type,permissions,org_id,org_external_id
admin,Administrator,environment,"users:manage,billing:manage",,`
    );

    // Pre-populate cache with different permissions
    const roleCache = new RoleCache({ dryRun: true });
    roleCache.set({
      slug: 'admin',
      id: 'role_existing',
      name: 'Administrator',
      permissions: ['users:manage', 'settings:manage'],
      type: 'EnvironmentRole',
      cachedAt: Date.now(),
    });

    const summary = await processRoleDefinitions({
      csvPath,
      roleCache,
      dryRun: true,
      quiet: true,
    });

    assert.strictEqual(summary.total, 1);
    assert.strictEqual(summary.alreadyExist, 1);
    assert.ok(summary.warnings.some(w => w.includes('Permission mismatch')));

    // Check detailed diff
    const adminResult = summary.results.find(r => r.slug === 'admin');
    assert.ok(adminResult);
    assert.ok(adminResult.permissionDiff);
    assert.deepStrictEqual(adminResult.permissionDiff.missing, ['billing:manage']);
    assert.deepStrictEqual(adminResult.permissionDiff.extra, ['settings:manage']);
  });

  await test('skips org roles missing org reference', async () => {
    const csvPath = writeCsv('no-org.csv',
      `role_slug,role_name,role_type,permissions,org_id,org_external_id
org-admin,Org Admin,organization,"members:manage",,`
    );

    const roleCache = new RoleCache({ dryRun: true });
    const summary = await processRoleDefinitions({
      csvPath,
      roleCache,
      dryRun: true,
      quiet: true,
    });

    // The CSV parser should have caught this — 0 definitions parsed
    assert.strictEqual(summary.total, 0);
  });

  await test('handles mixed env and org roles', async () => {
    const csvPath = writeCsv('mixed.csv',
      `role_slug,role_name,role_type,permissions,org_id,org_external_id
admin,Administrator,environment,"users:manage",,
org-admin,Org Admin,organization,"members:manage",org_123,`
    );

    const roleCache = new RoleCache({ dryRun: true });
    const summary = await processRoleDefinitions({
      csvPath,
      roleCache,
      dryRun: true,
      quiet: true,
    });

    assert.strictEqual(summary.total, 2);
    // admin: created (dry-run, not in cache)
    // org-admin: dry-run mode in cache returns null → creates
    assert.strictEqual(summary.created, 2);
  });

  await test('handles empty CSV (just headers)', async () => {
    const csvPath = writeCsv('empty.csv',
      `role_slug,role_name,role_type,permissions,org_id,org_external_id`
    );

    const roleCache = new RoleCache({ dryRun: true });
    const summary = await processRoleDefinitions({
      csvPath,
      roleCache,
      dryRun: true,
      quiet: true,
    });

    assert.strictEqual(summary.total, 0);
    assert.strictEqual(summary.created, 0);
    assert.strictEqual(summary.errors, 0);
  });

  await test('counts parse errors in summary', async () => {
    const csvPath = writeCsv('parse-errors.csv',
      `role_slug,role_name,role_type,permissions,org_id,org_external_id
,No Slug,environment,"read",,
admin,Administrator,environment,"users:manage",,`
    );

    const roleCache = new RoleCache({ dryRun: true });
    const summary = await processRoleDefinitions({
      csvPath,
      roleCache,
      dryRun: true,
      quiet: true,
    });

    // Only admin should be parsed, the empty slug row is an error
    assert.strictEqual(summary.total, 1);
    assert.strictEqual(summary.errors, 1); // 1 parse error
  });

  // Summary
  cleanup();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
