/**
 * Tests for Firebase JSON transformer (end-to-end)
 *
 * Usage: npx tsx src/transformers/firebase/__tests__/firebaseTransformer.test.ts
 */

import { strict as assert } from 'node:assert';
import { writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import path from 'node:path';

const TEST_DIR = path.join(process.cwd(), '.temp-firebase-transform-tests');

function setup() {
  mkdirSync(TEST_DIR, { recursive: true });
}

function cleanup() {
  rmSync(TEST_DIR, { recursive: true, force: true });
}

function writeFile(filename: string, content: string): string {
  const filePath = path.join(TEST_DIR, filename);
  writeFileSync(filePath, content, 'utf8');
  return filePath;
}

function writeJson(filename: string, data: unknown): string {
  return writeFile(filename, JSON.stringify(data));
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

  const { transformFirebaseExport, loadOrgMapping, loadRoleMapping } = await import('../firebaseTransformer.js');

  console.log('Firebase Transformer tests\n');

  // --- loadOrgMapping tests ---
  console.log('loadOrgMapping:');

  await test('loads org mapping keyed by firebase_uid', async () => {
    const csvPath = writeFile('org-mapping.csv',
      `firebase_uid,org_external_id,org_name
uid_01,acme-corp,Acme Corporation
uid_02,acme-corp,Acme Corporation
uid_03,beta-inc,Beta Inc`
    );

    const result = await loadOrgMapping(csvPath, true);
    assert.strictEqual(result.size, 3);
    assert.strictEqual(result.get('uid_01')?.org_external_id, 'acme-corp');
    assert.strictEqual(result.get('uid_01')?.org_name, 'Acme Corporation');
  });

  await test('rejects org mapping without firebase_uid column', async () => {
    const csvPath = writeFile('bad-org-mapping.csv',
      `user_id,org_name
uid_01,Acme`
    );

    try {
      await loadOrgMapping(csvPath, true);
      assert.fail('Should have thrown');
    } catch (err: any) {
      assert.ok(err.message.includes('firebase_uid'));
    }
  });

  // --- loadRoleMapping tests ---
  console.log('\nloadRoleMapping:');

  await test('loads role mapping keyed by firebase_uid', async () => {
    const csvPath = writeFile('role-mapping.csv',
      `firebase_uid,role_slug
uid_01,admin
uid_01,editor
uid_02,viewer`
    );

    const result = await loadRoleMapping(csvPath, true);
    assert.strictEqual(result.size, 2);
    assert.deepStrictEqual(result.get('uid_01'), ['admin', 'editor']);
    assert.deepStrictEqual(result.get('uid_02'), ['viewer']);
  });

  await test('deduplicates role slugs per user', async () => {
    const csvPath = writeFile('role-mapping-dupes.csv',
      `firebase_uid,role_slug
uid_01,admin
uid_01,admin
uid_01,editor`
    );

    const result = await loadRoleMapping(csvPath, true);
    assert.deepStrictEqual(result.get('uid_01'), ['admin', 'editor']);
  });

  await test('accepts external_id as join key', async () => {
    const csvPath = writeFile('role-mapping-extid.csv',
      `external_id,role_slug
uid_01,admin
uid_02,viewer`
    );

    const result = await loadRoleMapping(csvPath, true);
    assert.strictEqual(result.size, 2);
  });

  // --- transformFirebaseExport tests ---
  console.log('\ntransformFirebaseExport:');

  await test('transforms basic Firebase JSON to CSV', async () => {
    const jsonPath = writeJson('basic.json', {
      users: [
        { localId: 'uid_01', email: 'alice@test.com', emailVerified: true, displayName: 'Alice Smith' },
        { localId: 'uid_02', email: 'bob@test.com', emailVerified: false, displayName: 'Bob Jones' },
      ],
    });
    const outputPath = path.join(TEST_DIR, 'basic-output.csv');

    const summary = await transformFirebaseExport({
      firebaseJsonPath: jsonPath,
      outputPath,
      nameSplitStrategy: 'first-space',
      quiet: true,
    });

    assert.strictEqual(summary.totalUsers, 2);
    assert.strictEqual(summary.transformedUsers, 2);
    assert.strictEqual(summary.skippedUsers, 0);

    const output = readFileSync(outputPath, 'utf8');
    assert.ok(output.includes('alice@test.com'));
    assert.ok(output.includes('bob@test.com'));
    assert.ok(output.includes('Alice'));
    assert.ok(output.includes('Smith'));
  });

  await test('skips users without email', async () => {
    const jsonPath = writeJson('no-email.json', {
      users: [
        { localId: 'uid_01', email: 'valid@test.com', displayName: 'Valid' },
        { localId: 'uid_02', displayName: 'No Email' },
      ],
    });
    const outputPath = path.join(TEST_DIR, 'no-email-output.csv');
    const skippedPath = path.join(TEST_DIR, 'skipped.jsonl');

    const summary = await transformFirebaseExport({
      firebaseJsonPath: jsonPath,
      outputPath,
      nameSplitStrategy: 'first-space',
      skippedUsersPath: skippedPath,
      quiet: true,
    });

    assert.strictEqual(summary.totalUsers, 2);
    assert.strictEqual(summary.transformedUsers, 1);
    assert.strictEqual(summary.skippedUsers, 1);
    assert.strictEqual(summary.skippedReasons['Missing email address'], 1);

    // Verify skipped JSONL
    const skipped = readFileSync(skippedPath, 'utf8').trim();
    const skippedRecord = JSON.parse(skipped);
    assert.strictEqual(skippedRecord.firebase_uid, 'uid_02');
    assert.strictEqual(skippedRecord.reason, 'Missing email address');
  });

  await test('skips disabled users by default', async () => {
    const jsonPath = writeJson('disabled.json', {
      users: [
        { localId: 'uid_01', email: 'active@test.com' },
        { localId: 'uid_02', email: 'disabled@test.com', disabled: true },
      ],
    });
    const outputPath = path.join(TEST_DIR, 'disabled-output.csv');

    const summary = await transformFirebaseExport({
      firebaseJsonPath: jsonPath,
      outputPath,
      nameSplitStrategy: 'first-space',
      quiet: true,
    });

    assert.strictEqual(summary.transformedUsers, 1);
    assert.strictEqual(summary.skippedUsers, 1);
    assert.strictEqual(summary.disabledUsersSkipped, 1);
  });

  await test('includes disabled users when includeDisabled is true', async () => {
    const jsonPath = writeJson('disabled-include.json', {
      users: [
        { localId: 'uid_01', email: 'active@test.com' },
        { localId: 'uid_02', email: 'disabled@test.com', disabled: true },
      ],
    });
    const outputPath = path.join(TEST_DIR, 'disabled-include-output.csv');

    const summary = await transformFirebaseExport({
      firebaseJsonPath: jsonPath,
      outputPath,
      nameSplitStrategy: 'first-space',
      includeDisabled: true,
      quiet: true,
    });

    assert.strictEqual(summary.transformedUsers, 2);
    assert.strictEqual(summary.skippedUsers, 0);
  });

  await test('encodes passwords when scrypt params provided', async () => {
    const jsonPath = writeJson('with-passwords.json', {
      users: [
        {
          localId: 'uid_01',
          email: 'test@test.com',
          passwordHash: 'hashValue==',
          salt: 'saltValue==',
        },
      ],
    });
    const outputPath = path.join(TEST_DIR, 'passwords-output.csv');

    const summary = await transformFirebaseExport({
      firebaseJsonPath: jsonPath,
      outputPath,
      nameSplitStrategy: 'first-space',
      scryptParams: {
        signerKey: 'testKey==',
        saltSeparator: 'Bw==',
        rounds: 8,
        memCost: 14,
      },
      quiet: true,
    });

    assert.strictEqual(summary.usersWithPasswords, 1);
    assert.strictEqual(summary.usersWithoutPasswords, 0);

    const output = readFileSync(outputPath, 'utf8');
    assert.ok(output.includes('firebase-scrypt'));
  });

  await test('tracks users without passwords when no scrypt params', async () => {
    const jsonPath = writeJson('no-scrypt.json', {
      users: [
        {
          localId: 'uid_01',
          email: 'test@test.com',
          passwordHash: 'hashValue==',
          salt: 'saltValue==',
        },
      ],
    });
    const outputPath = path.join(TEST_DIR, 'no-scrypt-output.csv');

    const summary = await transformFirebaseExport({
      firebaseJsonPath: jsonPath,
      outputPath,
      nameSplitStrategy: 'first-space',
      quiet: true,
    });

    assert.strictEqual(summary.usersWithPasswords, 0);
    assert.strictEqual(summary.usersWithoutPasswords, 1);
  });

  await test('applies org mapping from CSV', async () => {
    const jsonPath = writeJson('with-org.json', {
      users: [
        { localId: 'uid_01', email: 'alice@test.com' },
        { localId: 'uid_02', email: 'bob@test.com' },
        { localId: 'uid_03', email: 'carol@test.com' },
      ],
    });
    const orgPath = writeFile('org.csv',
      `firebase_uid,org_external_id,org_name
uid_01,acme-corp,Acme Corporation
uid_02,acme-corp,Acme Corporation`
    );
    const outputPath = path.join(TEST_DIR, 'org-output.csv');

    const summary = await transformFirebaseExport({
      firebaseJsonPath: jsonPath,
      outputPath,
      nameSplitStrategy: 'first-space',
      orgMappingPath: orgPath,
      quiet: true,
    });

    assert.strictEqual(summary.usersWithOrgMapping, 2);
    assert.strictEqual(summary.usersWithoutOrgMapping, 1);

    const output = readFileSync(outputPath, 'utf8');
    assert.ok(output.includes('acme-corp'));
    assert.ok(output.includes('Acme Corporation'));
  });

  await test('applies role mapping from CSV', async () => {
    const jsonPath = writeJson('with-roles.json', {
      users: [
        { localId: 'uid_01', email: 'alice@test.com' },
        { localId: 'uid_02', email: 'bob@test.com' },
      ],
    });
    const rolePath = writeFile('roles.csv',
      `firebase_uid,role_slug
uid_01,admin
uid_01,editor
uid_02,viewer`
    );
    const outputPath = path.join(TEST_DIR, 'roles-output.csv');

    const summary = await transformFirebaseExport({
      firebaseJsonPath: jsonPath,
      outputPath,
      nameSplitStrategy: 'first-space',
      roleMappingPath: rolePath,
      quiet: true,
    });

    assert.strictEqual(summary.usersWithRoleMapping, 2);

    const output = readFileSync(outputPath, 'utf8');
    assert.ok(output.includes('role_slugs'));
    assert.ok(output.includes('admin,editor'));
    assert.ok(output.includes('viewer'));
  });

  await test('handles empty users array gracefully', async () => {
    const jsonPath = writeJson('empty.json', { users: [] });
    const outputPath = path.join(TEST_DIR, 'empty-output.csv');

    const summary = await transformFirebaseExport({
      firebaseJsonPath: jsonPath,
      outputPath,
      nameSplitStrategy: 'first-space',
      quiet: true,
    });

    assert.strictEqual(summary.totalUsers, 0);
    assert.strictEqual(summary.transformedUsers, 0);
  });

  await test('rejects invalid JSON', async () => {
    const jsonPath = writeFile('invalid.json', 'not json');

    try {
      await transformFirebaseExport({
        firebaseJsonPath: jsonPath,
        outputPath: path.join(TEST_DIR, 'invalid-output.csv'),
        nameSplitStrategy: 'first-space',
        quiet: true,
      });
      assert.fail('Should have thrown');
    } catch (err: any) {
      assert.ok(err.message.includes('Invalid JSON'));
    }
  });

  await test('rejects JSON without users array', async () => {
    const jsonPath = writeJson('no-users.json', { accounts: [] });

    try {
      await transformFirebaseExport({
        firebaseJsonPath: jsonPath,
        outputPath: path.join(TEST_DIR, 'no-users-output.csv'),
        nameSplitStrategy: 'first-space',
        quiet: true,
      });
      assert.fail('Should have thrown');
    } catch (err: any) {
      assert.ok(err.message.includes('users'));
    }
  });

  // Cleanup
  cleanup();

  // Summary
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
