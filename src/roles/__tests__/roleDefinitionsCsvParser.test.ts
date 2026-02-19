/**
 * Tests for roleDefinitionsCsvParser
 *
 * Usage: npx tsx src/roles/__tests__/roleDefinitionsCsvParser.test.ts
 */

import { strict as assert } from 'node:assert';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { parsePermissions, parseRoleDefinitionsCsv } from '../roleDefinitionsCsvParser.js';

const TEST_DIR = path.join(process.cwd(), '.temp-role-tests');

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

  console.log('roleDefinitionsCsvParser tests\n');

  // --- parsePermissions tests ---
  console.log('parsePermissions:');

  await test('parses comma-separated permissions', () => {
    const result = parsePermissions('a,b,c');
    assert.deepStrictEqual(result, ['a', 'b', 'c']);
  });

  await test('parses JSON array permissions', () => {
    const result = parsePermissions('["a","b","c"]');
    assert.deepStrictEqual(result, ['a', 'b', 'c']);
  });

  await test('handles empty string', () => {
    const result = parsePermissions('');
    assert.deepStrictEqual(result, []);
  });

  await test('handles whitespace-only string', () => {
    const result = parsePermissions('   ');
    assert.deepStrictEqual(result, []);
  });

  await test('trims whitespace in comma-separated', () => {
    const result = parsePermissions(' a , b , c ');
    assert.deepStrictEqual(result, ['a', 'b', 'c']);
  });

  await test('handles single permission', () => {
    const result = parsePermissions('read');
    assert.deepStrictEqual(result, ['read']);
  });

  await test('falls back to comma-split on invalid JSON', () => {
    const result = parsePermissions('[not valid json');
    assert.deepStrictEqual(result, ['[not valid json']);
  });

  // --- parseRoleDefinitionsCsv tests ---
  console.log('\nparseRoleDefinitionsCsv:');

  await test('parses valid CSV with environment and org roles', async () => {
    const csvPath = writeCsv('valid.csv',
      `role_slug,role_name,role_type,permissions,org_id,org_external_id
admin,Administrator,environment,"users:manage,billing:manage",,
org-admin,Org Admin,organization,"members:manage",,acme-corp`
    );

    const result = await parseRoleDefinitionsCsv(csvPath);
    assert.strictEqual(result.definitions.length, 2);
    assert.strictEqual(result.errors.length, 0);

    // Environment role
    assert.strictEqual(result.definitions[0]!.slug, 'admin');
    assert.strictEqual(result.definitions[0]!.type, 'environment');
    assert.deepStrictEqual(result.definitions[0]!.permissions, ['users:manage', 'billing:manage']);

    // Org role
    assert.strictEqual(result.definitions[1]!.slug, 'org-admin');
    assert.strictEqual(result.definitions[1]!.type, 'organization');
    assert.strictEqual(result.definitions[1]!.orgExternalId, 'acme-corp');
  });

  await test('throws on missing required columns', async () => {
    const csvPath = writeCsv('missing-cols.csv',
      `role_slug,role_name
admin,Administrator`
    );

    await assert.rejects(
      () => parseRoleDefinitionsCsv(csvPath),
      /missing required columns.*role_type.*permissions/i
    );
  });

  await test('throws on non-existent file', async () => {
    await assert.rejects(
      () => parseRoleDefinitionsCsv('/nonexistent/file.csv'),
      /not found/
    );
  });

  await test('warns on invalid role_type', async () => {
    const csvPath = writeCsv('bad-type.csv',
      `role_slug,role_name,role_type,permissions,org_id,org_external_id
admin,Administrator,invalid,"read",,`
    );

    const result = await parseRoleDefinitionsCsv(csvPath);
    assert.strictEqual(result.definitions.length, 0);
    assert.ok(result.warnings.some(w => w.includes('Invalid role_type')));
  });

  await test('warns on org role without org reference', async () => {
    const csvPath = writeCsv('no-org-ref.csv',
      `role_slug,role_name,role_type,permissions,org_id,org_external_id
org-admin,Org Admin,organization,"members:manage",,`
    );

    const result = await parseRoleDefinitionsCsv(csvPath);
    assert.strictEqual(result.definitions.length, 0);
    assert.ok(result.warnings.some(w => w.includes('missing org_id or org_external_id')));
  });

  await test('warns on duplicate role_slug in same scope', async () => {
    const csvPath = writeCsv('dupe.csv',
      `role_slug,role_name,role_type,permissions,org_id,org_external_id
admin,Administrator,environment,"read",,
admin,Admin Duplicate,environment,"write",,`
    );

    const result = await parseRoleDefinitionsCsv(csvPath);
    assert.strictEqual(result.definitions.length, 1);
    assert.strictEqual(result.definitions[0]!.slug, 'admin');
    assert.deepStrictEqual(result.definitions[0]!.permissions, ['read']);
    assert.ok(result.warnings.some(w => w.includes('Duplicate role_slug')));
  });

  await test('errors on missing role_slug', async () => {
    const csvPath = writeCsv('no-slug.csv',
      `role_slug,role_name,role_type,permissions,org_id,org_external_id
,NoSlug,environment,"read",,`
    );

    const result = await parseRoleDefinitionsCsv(csvPath);
    assert.strictEqual(result.definitions.length, 0);
    assert.ok(result.errors.some(e => e.includes('Missing role_slug')));
  });

  await test('handles JSON array permissions in CSV', async () => {
    const csvPath = writeCsv('json-perms.csv',
      `role_slug,role_name,role_type,permissions,org_id,org_external_id
admin,Administrator,environment,"[""users:manage"",""billing:manage""]",,`
    );

    const result = await parseRoleDefinitionsCsv(csvPath);
    assert.strictEqual(result.definitions.length, 1);
    assert.deepStrictEqual(result.definitions[0]!.permissions, ['users:manage', 'billing:manage']);
  });

  // Summary
  cleanup();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
