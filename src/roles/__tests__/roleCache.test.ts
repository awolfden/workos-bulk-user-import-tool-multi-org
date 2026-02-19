/**
 * Tests for RoleCache
 *
 * Usage: npx tsx src/roles/__tests__/roleCache.test.ts
 */

import { strict as assert } from 'node:assert';
import { RoleCache } from '../roleCache.js';
import type { RoleCacheEntry, SerializedRoleCacheEntry } from '../types.js';

function makeEntry(overrides: Partial<RoleCacheEntry> = {}): RoleCacheEntry {
  return {
    slug: 'admin',
    id: 'role_123',
    name: 'Administrator',
    permissions: ['users:manage'],
    type: 'EnvironmentRole',
    cachedAt: Date.now(),
    ...overrides,
  };
}

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

  console.log('RoleCache tests\n');

  // --- Basic cache operations ---
  console.log('Basic operations:');

  await test('set and resolve environment role from cache', async () => {
    const cache = new RoleCache({ dryRun: true });
    const entry = makeEntry();
    cache.set(entry);

    const result = await cache.resolve('admin');
    assert.ok(result);
    assert.strictEqual(result.slug, 'admin');
    assert.strictEqual(result.id, 'role_123');
  });

  await test('set and resolve org role from cache', async () => {
    const cache = new RoleCache({ dryRun: true });
    const entry = makeEntry({
      slug: 'org-admin',
      id: 'role_456',
      type: 'OrganizationRole',
      orgId: 'org_abc',
    });
    cache.set(entry);

    const result = await cache.resolve('org-admin', 'org_abc');
    assert.ok(result);
    assert.strictEqual(result.slug, 'org-admin');
    assert.strictEqual(result.orgId, 'org_abc');
  });

  await test('returns null for missing role in dry-run mode', async () => {
    const cache = new RoleCache({ dryRun: true });
    const result = await cache.resolve('nonexistent');
    assert.strictEqual(result, null);
  });

  await test('env and org roles with same slug are stored separately', async () => {
    const cache = new RoleCache({ dryRun: true });

    cache.set(makeEntry({
      slug: 'admin',
      id: 'env_role_1',
      type: 'EnvironmentRole',
    }));

    cache.set(makeEntry({
      slug: 'admin',
      id: 'org_role_1',
      type: 'OrganizationRole',
      orgId: 'org_abc',
    }));

    const envResult = await cache.resolve('admin');
    const orgResult = await cache.resolve('admin', 'org_abc');

    assert.ok(envResult);
    assert.ok(orgResult);
    assert.strictEqual(envResult.id, 'env_role_1');
    assert.strictEqual(orgResult.id, 'org_role_1');
  });

  // --- LRU eviction ---
  console.log('\nLRU eviction:');

  await test('evicts oldest entry when at capacity', async () => {
    const cache = new RoleCache({ maxSize: 2, dryRun: true });

    cache.set(makeEntry({ slug: 'role1', id: 'id1' }));
    cache.set(makeEntry({ slug: 'role2', id: 'id2' }));
    cache.set(makeEntry({ slug: 'role3', id: 'id3' }));

    // role1 should be evicted
    const r1 = await cache.resolve('role1');
    const r2 = await cache.resolve('role2');
    const r3 = await cache.resolve('role3');

    assert.strictEqual(r1, null);
    assert.ok(r2);
    assert.ok(r3);
  });

  // --- Statistics ---
  console.log('\nStatistics:');

  await test('tracks hits and misses', async () => {
    const cache = new RoleCache({ dryRun: true });
    cache.set(makeEntry({ slug: 'admin' }));

    await cache.resolve('admin'); // hit
    await cache.resolve('admin'); // hit
    await cache.resolve('nonexistent'); // miss

    const stats = cache.getStats();
    assert.strictEqual(stats.hits, 2);
    assert.strictEqual(stats.misses, 1);
    assert.ok(Math.abs(stats.hitRate - 2 / 3) < 0.01);
  });

  await test('reports correct size and capacity', async () => {
    const cache = new RoleCache({ maxSize: 500, dryRun: true });
    cache.set(makeEntry({ slug: 'role1' }));
    cache.set(makeEntry({ slug: 'role2' }));

    const stats = cache.getStats();
    assert.strictEqual(stats.size, 2);
    assert.strictEqual(stats.capacity, 500);
  });

  // --- Serialization ---
  console.log('\nSerialization:');

  await test('serialize and deserialize round-trip', async () => {
    const cache = new RoleCache({ dryRun: true });
    cache.set(makeEntry({ slug: 'admin', id: 'id1', permissions: ['read', 'write'] }));
    cache.set(makeEntry({
      slug: 'org-admin',
      id: 'id2',
      type: 'OrganizationRole',
      orgId: 'org_1',
      permissions: ['manage'],
    }));

    const serialized = cache.serialize();
    assert.strictEqual(serialized.length, 2);

    const restored = RoleCache.deserialize(serialized, { dryRun: true });

    const r1 = await restored.resolve('admin');
    const r2 = await restored.resolve('org-admin', 'org_1');

    assert.ok(r1);
    assert.strictEqual(r1.id, 'id1');
    assert.deepStrictEqual(r1.permissions, ['read', 'write']);

    assert.ok(r2);
    assert.strictEqual(r2.id, 'id2');
    assert.deepStrictEqual(r2.permissions, ['manage']);
  });

  // --- Clear ---
  console.log('\nClear:');

  await test('clear removes all entries and resets stats', async () => {
    const cache = new RoleCache({ dryRun: true });
    cache.set(makeEntry());
    await cache.resolve('admin'); // hit

    cache.clear();

    const stats = cache.getStats();
    assert.strictEqual(stats.size, 0);
    assert.strictEqual(stats.hits, 0);
    assert.strictEqual(stats.misses, 0);
  });

  // Summary
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
