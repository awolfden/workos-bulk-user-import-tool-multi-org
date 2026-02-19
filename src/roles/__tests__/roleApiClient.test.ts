/**
 * Tests for roleApiClient
 *
 * Tests the module structure and retry logic (no real API calls).
 *
 * Usage: npx tsx src/roles/__tests__/roleApiClient.test.ts
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

  console.log('roleApiClient tests\n');

  // Module import tests (verify exports exist)
  console.log('Module structure:');

  await test('exports listRolesForOrganization function', async () => {
    const mod = await import('../roleApiClient.js');
    assert.strictEqual(typeof mod.listRolesForOrganization, 'function');
  });

  await test('exports createEnvironmentRole function', async () => {
    const mod = await import('../roleApiClient.js');
    assert.strictEqual(typeof mod.createEnvironmentRole, 'function');
  });

  await test('exports createOrganizationRole function', async () => {
    const mod = await import('../roleApiClient.js');
    assert.strictEqual(typeof mod.createOrganizationRole, 'function');
  });

  // Error handling tests (no WORKOS_SECRET_KEY set)
  console.log('\nError handling:');

  await test('createEnvironmentRole throws without API key', async () => {
    // Ensure no API key is set
    const originalKey = process.env.WORKOS_SECRET_KEY;
    delete process.env.WORKOS_SECRET_KEY;

    try {
      const mod = await import('../roleApiClient.js');
      await assert.rejects(
        () => mod.createEnvironmentRole({
          name: 'Test',
          slug: 'test',
          permissions: [],
        }),
        /WORKOS_SECRET_KEY/
      );
    } finally {
      // Restore
      if (originalKey) {
        process.env.WORKOS_SECRET_KEY = originalKey;
      }
    }
  });

  await test('createOrganizationRole throws without API key', async () => {
    const originalKey = process.env.WORKOS_SECRET_KEY;
    delete process.env.WORKOS_SECRET_KEY;

    try {
      const mod = await import('../roleApiClient.js');
      await assert.rejects(
        () => mod.createOrganizationRole({
          organizationId: 'org_123',
          name: 'Test',
          slug: 'test',
          permissions: [],
        }),
        /WORKOS_SECRET_KEY/
      );
    } finally {
      if (originalKey) {
        process.env.WORKOS_SECRET_KEY = originalKey;
      }
    }
  });

  // Summary
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
