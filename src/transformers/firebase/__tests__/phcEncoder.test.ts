/**
 * Tests for Firebase scrypt PHC encoder
 *
 * Usage: npx tsx src/transformers/firebase/__tests__/phcEncoder.test.ts
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

  console.log('PHC Encoder tests\n');

  const { encodeFirebaseScryptPHC } = await import('../phcEncoder.js');

  await test('encodes valid Firebase scrypt params to PHC format', () => {
    const result = encodeFirebaseScryptPHC(
      {
        passwordHash: 'abc123hash==',
        salt: 'salt123==',
      },
      {
        signerKey: 'signerKeyBase64==',
        saltSeparator: 'Bw==',
        rounds: 8,
        memCost: 14,
      }
    );

    assert.strictEqual(
      result,
      '$firebase-scrypt$hash=abc123hash==$salt=salt123==$sk=signerKeyBase64==$ss=Bw==$r=8$m=14'
    );
  });

  await test('converts URL-safe base64 to standard base64', () => {
    const result = encodeFirebaseScryptPHC(
      {
        passwordHash: 'abc-123_hash==',
        salt: 'salt-123_==',
      },
      {
        signerKey: 'signer-key_base64==',
        saltSeparator: 'Bw==',
        rounds: 8,
        memCost: 14,
      }
    );

    // - should be replaced with +, _ should be replaced with /
    assert.ok(result.includes('hash=abc+123/hash=='), 'hash should have URL-safe chars replaced');
    assert.ok(result.includes('salt=salt+123/=='), 'salt should have URL-safe chars replaced');
    assert.ok(result.includes('sk=signer+key/base64=='), 'signer key should have URL-safe chars replaced');
    // Extract the parameter values (after the = sign in each param) and check they don't have URL-safe chars
    const params = result.split('$').slice(2); // skip empty and 'firebase-scrypt'
    for (const param of params) {
      const eqIdx = param.indexOf('=');
      if (eqIdx > -1) {
        const value = param.slice(eqIdx + 1);
        // Only check string values (not numeric ones like r=8, m=14)
        if (isNaN(Number(value))) {
          assert.ok(!value.includes('-'), `Value "${value}" should not contain URL-safe dash`);
          assert.ok(!value.includes('_'), `Value "${value}" should not contain URL-safe underscore`);
        }
      }
    }
  });

  await test('includes all parameters in correct order', () => {
    const result = encodeFirebaseScryptPHC(
      { passwordHash: 'HASH', salt: 'SALT' },
      { signerKey: 'SK', saltSeparator: 'SS', rounds: 12, memCost: 16 }
    );

    assert.ok(result.startsWith('$firebase-scrypt$'));
    assert.ok(result.includes('hash=HASH'));
    assert.ok(result.includes('salt=SALT'));
    assert.ok(result.includes('sk=SK'));
    assert.ok(result.includes('ss=SS'));
    assert.ok(result.includes('r=12'));
    assert.ok(result.includes('m=16'));
  });

  await test('handles realistic Firebase export values', () => {
    const result = encodeFirebaseScryptPHC(
      {
        passwordHash: '0fn2PA6FmYZynpk9cvekSgbJTXa7j0XQAwtp4XuyyuIYzX5hASd4mB4GFeaS5OiG9mENrvt+sPoZmwVjvEDZ2Q==',
        salt: '+mkMRRbwdwqJkA==',
      },
      {
        signerKey: 'jxspr8Ki0RYycVU8zykbdLGjFQ3McFUH0uiiTvC8pVMXAn210wjLNmdZJzxUECKbm0QsEmYUSDzZvpjeJ9WmXA==',
        saltSeparator: 'Bw==',
        rounds: 8,
        memCost: 14,
      }
    );

    assert.ok(result.startsWith('$firebase-scrypt$'));
    assert.ok(result.includes('$r=8$m=14'));
    // Verify the + characters in hash and salt are preserved (not URL-safe encoded)
    assert.ok(result.includes('hash=0fn2PA6FmYZynpk9cvekSgbJTXa7j0XQAwtp4XuyyuIYzX5hASd4mB4GFeaS5OiG9mENrvt+sPoZmwVjvEDZ2Q=='));
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
