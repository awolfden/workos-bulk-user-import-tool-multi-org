/**
 * Tests for Firebase to WorkOS field mapper
 *
 * Usage: npx tsx src/transformers/firebase/__tests__/firebaseMapper.test.ts
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

  const { mapFirebaseUserToWorkOS, splitDisplayName } = await import('../firebaseMapper.js');

  // --- splitDisplayName tests ---
  console.log('splitDisplayName:\n');

  await test('first-space: splits "John Doe" into John / Doe', () => {
    const result = splitDisplayName('John Doe', 'first-space');
    assert.strictEqual(result.firstName, 'John');
    assert.strictEqual(result.lastName, 'Doe');
  });

  await test('first-space: single name "John" -> first only', () => {
    const result = splitDisplayName('John', 'first-space');
    assert.strictEqual(result.firstName, 'John');
    assert.strictEqual(result.lastName, '');
  });

  await test('first-space: "Mary Jane Watson" -> Mary / Jane Watson', () => {
    const result = splitDisplayName('Mary Jane Watson', 'first-space');
    assert.strictEqual(result.firstName, 'Mary');
    assert.strictEqual(result.lastName, 'Jane Watson');
  });

  await test('last-space: "Mary Jane Watson" -> Mary Jane / Watson', () => {
    const result = splitDisplayName('Mary Jane Watson', 'last-space');
    assert.strictEqual(result.firstName, 'Mary Jane');
    assert.strictEqual(result.lastName, 'Watson');
  });

  await test('last-space: single name "John" -> first only', () => {
    const result = splitDisplayName('John', 'last-space');
    assert.strictEqual(result.firstName, 'John');
    assert.strictEqual(result.lastName, '');
  });

  await test('first-name-only: "John Doe" -> John Doe / empty', () => {
    const result = splitDisplayName('John Doe', 'first-name-only');
    assert.strictEqual(result.firstName, 'John Doe');
    assert.strictEqual(result.lastName, '');
  });

  await test('handles undefined displayName', () => {
    const result = splitDisplayName(undefined, 'first-space');
    assert.strictEqual(result.firstName, '');
    assert.strictEqual(result.lastName, '');
  });

  await test('handles empty displayName', () => {
    const result = splitDisplayName('', 'first-space');
    assert.strictEqual(result.firstName, '');
    assert.strictEqual(result.lastName, '');
  });

  await test('trims whitespace from displayName', () => {
    const result = splitDisplayName('  John Doe  ', 'first-space');
    assert.strictEqual(result.firstName, 'John');
    assert.strictEqual(result.lastName, 'Doe');
  });

  // --- mapFirebaseUserToWorkOS tests ---
  console.log('\nmapFirebaseUserToWorkOS:\n');

  const defaultOptions = {
    nameSplitStrategy: 'first-space' as const,
    scryptParams: {
      signerKey: 'testSignerKey==',
      saltSeparator: 'Bw==',
      rounds: 8,
      memCost: 14,
    },
  };

  await test('maps basic user fields correctly', () => {
    const result = mapFirebaseUserToWorkOS(
      {
        localId: 'uid_01',
        email: 'test@example.com',
        emailVerified: true,
        displayName: 'John Doe',
        passwordHash: 'hashValue==',
        salt: 'saltValue==',
      },
      defaultOptions
    );

    assert.strictEqual(result.skipped, false);
    assert.strictEqual(result.row.email, 'test@example.com');
    assert.strictEqual(result.row.first_name, 'John');
    assert.strictEqual(result.row.last_name, 'Doe');
    assert.strictEqual(result.row.email_verified, 'true');
    assert.strictEqual(result.row.external_id, 'uid_01');
    assert.strictEqual(result.row.password_hash_type, 'firebase-scrypt');
    assert.ok(result.row.password_hash?.startsWith('$firebase-scrypt$'));
  });

  await test('skips users without email', () => {
    const result = mapFirebaseUserToWorkOS(
      { localId: 'uid_no_email', displayName: 'No Email' },
      defaultOptions
    );

    assert.strictEqual(result.skipped, true);
    assert.strictEqual(result.skipReason, 'Missing email address');
  });

  await test('skips disabled users by default', () => {
    const result = mapFirebaseUserToWorkOS(
      { localId: 'uid_disabled', email: 'disabled@test.com', disabled: true },
      defaultOptions
    );

    assert.strictEqual(result.skipped, true);
    assert.strictEqual(result.skipReason, 'User is disabled');
  });

  await test('includes disabled users when includeDisabled is true', () => {
    const result = mapFirebaseUserToWorkOS(
      { localId: 'uid_disabled', email: 'disabled@test.com', disabled: true },
      { ...defaultOptions, includeDisabled: true }
    );

    assert.strictEqual(result.skipped, false);
    assert.strictEqual(result.row.email, 'disabled@test.com');
    // Check metadata includes disabled flag
    const metadata = JSON.parse(result.row.metadata as string);
    assert.strictEqual(metadata.disabled, true);
  });

  await test('encodes password hash to PHC format when scrypt params provided', () => {
    const result = mapFirebaseUserToWorkOS(
      {
        localId: 'uid_01',
        email: 'test@example.com',
        passwordHash: 'hash==',
        salt: 'salt==',
      },
      defaultOptions
    );

    assert.strictEqual(result.row.password_hash_type, 'firebase-scrypt');
    assert.ok(result.row.password_hash?.includes('$firebase-scrypt$'));
    assert.ok(result.row.password_hash?.includes('hash=hash=='));
    assert.ok(result.row.password_hash?.includes('salt=salt=='));
  });

  await test('omits password when scrypt params not provided', () => {
    const result = mapFirebaseUserToWorkOS(
      {
        localId: 'uid_01',
        email: 'test@example.com',
        passwordHash: 'hash==',
        salt: 'salt==',
      },
      { nameSplitStrategy: 'first-space' } // no scryptParams
    );

    assert.strictEqual(result.row.password_hash, undefined);
    assert.strictEqual(result.row.password_hash_type, undefined);
    assert.strictEqual(result.warnings.length, 1);
    assert.ok(result.warnings[0]!.includes('No scrypt parameters'));
  });

  await test('omits password when user has no passwordHash', () => {
    const result = mapFirebaseUserToWorkOS(
      { localId: 'uid_01', email: 'test@example.com' },
      defaultOptions
    );

    assert.strictEqual(result.row.password_hash, undefined);
    assert.strictEqual(result.row.password_hash_type, undefined);
  });

  await test('sets email_verified to false when not verified', () => {
    const result = mapFirebaseUserToWorkOS(
      { localId: 'uid_01', email: 'test@example.com', emailVerified: false },
      defaultOptions
    );

    assert.strictEqual(result.row.email_verified, 'false');
  });

  await test('stores phoneNumber, photoUrl in metadata', () => {
    const result = mapFirebaseUserToWorkOS(
      {
        localId: 'uid_01',
        email: 'test@example.com',
        phoneNumber: '+15551234567',
        photoUrl: 'https://example.com/photo.jpg',
      },
      defaultOptions
    );

    const metadata = JSON.parse(result.row.metadata as string);
    assert.strictEqual(metadata.phone_number, '+15551234567');
    assert.strictEqual(metadata.photo_url, 'https://example.com/photo.jpg');
  });

  await test('parses customAttributes JSON into metadata', () => {
    const result = mapFirebaseUserToWorkOS(
      {
        localId: 'uid_01',
        email: 'test@example.com',
        customAttributes: '{"role":"admin","plan":"premium"}',
      },
      defaultOptions
    );

    const metadata = JSON.parse(result.row.metadata as string);
    assert.deepStrictEqual(metadata.custom_attributes, { role: 'admin', plan: 'premium' });
  });

  await test('stores providerUserInfo in metadata', () => {
    const providers = [
      { providerId: 'google.com', rawId: '123', email: 'test@gmail.com', displayName: 'Test' },
    ];
    const result = mapFirebaseUserToWorkOS(
      {
        localId: 'uid_01',
        email: 'test@example.com',
        providerUserInfo: providers,
      },
      defaultOptions
    );

    const metadata = JSON.parse(result.row.metadata as string);
    assert.deepStrictEqual(metadata.provider_info, providers);
  });

  await test('stores mfaInfo in metadata', () => {
    const mfa = [
      { mfaEnrollmentId: 'mfa_01', displayName: 'Phone', phoneInfo: '+1555', enrolledAt: '2023-01-01T00:00:00Z' },
    ];
    const result = mapFirebaseUserToWorkOS(
      {
        localId: 'uid_01',
        email: 'test@example.com',
        mfaInfo: mfa,
      },
      defaultOptions
    );

    const metadata = JSON.parse(result.row.metadata as string);
    assert.deepStrictEqual(metadata.mfa_info, mfa);
  });

  await test('converts ms epoch timestamps to ISO 8601 in metadata', () => {
    const result = mapFirebaseUserToWorkOS(
      {
        localId: 'uid_01',
        email: 'test@example.com',
        createdAt: '1648020042135',
        lastSignedInAt: '1700000000000',
      },
      defaultOptions
    );

    const metadata = JSON.parse(result.row.metadata as string);
    assert.strictEqual(metadata.created_at, '2022-03-23T07:20:42.135Z');
    assert.strictEqual(metadata.last_signed_in_at, '2023-11-14T22:13:20.000Z');
  });

  await test('always includes firebase_uid in metadata', () => {
    const result = mapFirebaseUserToWorkOS(
      { localId: 'uid_test', email: 'test@example.com' },
      defaultOptions
    );

    const metadata = JSON.parse(result.row.metadata as string);
    assert.strictEqual(metadata.firebase_uid, 'uid_test');
  });

  await test('applies org mapping when provided', () => {
    const result = mapFirebaseUserToWorkOS(
      { localId: 'uid_01', email: 'test@example.com' },
      defaultOptions,
      { firebase_uid: 'uid_01', org_external_id: 'acme-corp', org_name: 'Acme Corporation' }
    );

    assert.strictEqual(result.row.org_external_id, 'acme-corp');
    assert.strictEqual(result.row.org_name, 'Acme Corporation');
  });

  await test('org mapping: org_id takes priority', () => {
    const result = mapFirebaseUserToWorkOS(
      { localId: 'uid_01', email: 'test@example.com' },
      defaultOptions,
      { firebase_uid: 'uid_01', org_id: 'org_abc', org_external_id: 'acme-corp', org_name: 'Acme' }
    );

    assert.strictEqual(result.row.org_id, 'org_abc');
    assert.strictEqual(result.row.org_external_id, undefined);
    assert.strictEqual(result.row.org_name, undefined);
  });

  await test('handles user with no displayName', () => {
    const result = mapFirebaseUserToWorkOS(
      { localId: 'uid_01', email: 'test@example.com' },
      defaultOptions
    );

    assert.strictEqual(result.row.first_name, undefined);
    assert.strictEqual(result.row.last_name, undefined);
  });

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
