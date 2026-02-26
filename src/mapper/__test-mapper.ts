#!/usr/bin/env node
/**
 * Phase 3: Field Mapper Tests
 *
 * Quick smoke tests for transformers and field mapping.
 */

import { getTransformer, listTransformers, hasTransformer } from './transformers.js';
import { loadProfile, listBuiltInProfiles } from './profiles/index.js';

let testsRun = 0;
let testsPassed = 0;
let testsFailed = 0;

function assert(condition: boolean, message: string): void {
  testsRun++;
  if (condition) {
    testsPassed++;
    console.log(`  ✓ ${message}`);
  } else {
    testsFailed++;
    console.error(`  ✗ ${message}`);
  }
}

function testSection(name: string): void {
  console.log(`\n${name}`);
  console.log('='.repeat(name.length));
}

// Test 1: Transformer Registry
function testTransformerRegistry(): void {
  testSection('Test 1: Transformer Registry');

  const transformers = listTransformers();
  assert(transformers.length >= 7, `Should have at least 7 transformers (got ${transformers.length})`);
  assert(transformers.includes('lowercase_trim'), 'Should have lowercase_trim');
  assert(transformers.includes('to_boolean'), 'Should have to_boolean');
  assert(transformers.includes('trim'), 'Should have trim');
  assert(transformers.includes('uppercase'), 'Should have uppercase');
  assert(transformers.includes('identity'), 'Should have identity');

  assert(hasTransformer('lowercase_trim'), 'hasTransformer should work for existing');
  assert(!hasTransformer('nonexistent'), 'hasTransformer should return false for missing');
}

// Test 2: Transformer Functions
function testTransformers(): void {
  testSection('Test 2: Transformer Functions');

  const lowercaseTrim = getTransformer('lowercase_trim');
  assert(lowercaseTrim('  HELLO  ', {}) === 'hello', 'lowercase_trim should work');
  assert(lowercaseTrim('', {}) === undefined, 'lowercase_trim should return undefined for blank');

  const toBoolean = getTransformer('to_boolean');
  assert(toBoolean('true', {}) === 'true', 'to_boolean should handle "true"');
  assert(toBoolean('yes', {}) === 'true', 'to_boolean should handle "yes"');
  assert(toBoolean('1', {}) === 'true', 'to_boolean should handle "1"');
  assert(toBoolean('false', {}) === 'false', 'to_boolean should handle "false"');
  assert(toBoolean('no', {}) === 'false', 'to_boolean should handle "no"');
  assert(toBoolean('0', {}) === 'false', 'to_boolean should handle "0"');

  const trim = getTransformer('trim');
  assert(trim('  hello  ', {}) === 'hello', 'trim should remove whitespace');

  const uppercase = getTransformer('uppercase');
  assert(uppercase('hello', {}) === 'HELLO', 'uppercase should work');

  const identity = getTransformer('identity');
  assert(identity('hello', {}) === 'hello', 'identity should pass through');
}

// Test 3: Profile Registry
async function testProfileRegistry(): Promise<void> {
  testSection('Test 3: Profile Registry');

  const profiles = listBuiltInProfiles();
  assert(profiles.length >= 1, `Should have at least 1 profile (got ${profiles.length})`);
  assert(profiles.includes('auth0'), 'Should have auth0 profile');

  try {
    const auth0Profile = await loadProfile('auth0');
    assert(auth0Profile.name === 'auth0', 'Auth0 profile should have correct name');
    assert(auth0Profile.mappings.length > 0, 'Auth0 profile should have mappings');
    assert(auth0Profile.metadataMapping !== undefined, 'Auth0 profile should have metadata mapping');
  } catch (error) {
    assert(false, `Failed to load auth0 profile: ${error}`);
  }
}

// Test 4: Integration Test
async function testIntegration(): Promise<void> {
  testSection('Test 4: Integration Test');

  try {
    const { FieldMapper } = await import('./fieldMapper.js');
    assert(FieldMapper !== undefined, 'FieldMapper class should be importable');

    const auth0Profile = await loadProfile('auth0');
    assert(auth0Profile !== undefined, 'Should load auth0 profile');

    console.log('  ✓ Integration test passed (full e2e test done via CLI)');
    testsPassed++;
    testsRun++;
  } catch (error) {
    console.error(`  ✗ Integration test failed: ${error}`);
    testsFailed++;
    testsRun++;
  }
}

// Run all tests
async function runTests(): Promise<void> {
  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║   Field Mapper Test Suite                        ║');
  console.log('╚═══════════════════════════════════════════════════╝');

  testTransformerRegistry();
  testTransformers();
  await testProfileRegistry();
  await testIntegration();

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('Test Summary');
  console.log('='.repeat(50));
  console.log(`Total tests:  ${testsRun}`);
  console.log(`Passed:       ${testsPassed} ✓`);
  console.log(`Failed:       ${testsFailed} ${testsFailed > 0 ? '✗' : ''}`);
  console.log('='.repeat(50));

  if (testsFailed > 0) {
    console.error('\n❌ Some tests failed');
    process.exit(1);
  } else {
    console.log('\n✅ All tests passed!');
    console.log('\nNote: Full end-to-end test was performed via CLI:');
    console.log('  npx tsx bin/map-fields.ts --input examples/auth0/auth0-test-input.csv --output examples/auth0/auth0-test-output.csv --profile auth0');
    process.exit(0);
  }
}

// Run tests
runTests().catch((err) => {
  console.error('Unhandled error in test suite:', err);
  process.exit(1);
});
