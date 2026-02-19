/**
 * Tests for migration planner role integration
 *
 * Usage: npx vitest run src/wizard/__tests__/migrationPlannerRoles.test.ts
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

  console.log('Migration Planner Roles tests\n');

  const { generateMigrationPlan } = await import('../migrationPlanner.js');

  // --- Role definitions step ---
  console.log('Role definitions step:');

  await test('includes process-role-definitions step when configured', () => {
    const plan = generateMigrationPlan({
      source: 'custom',
      customCsvPath: 'users.csv',
      importMode: 'single-org',
      orgId: 'org_123',
      scale: 'small',
      enableCheckpointing: false,
      validateCsv: true,
      logErrors: true,
      hasRoleDefinitions: true,
      roleDefinitionsPath: 'role-definitions.csv',
      hasRoleMapping: true,
      roleMappingPath: 'user-role-mapping.csv',
    });

    const roleDefStep = plan.steps.find(s => s.id === 'process-role-definitions');
    assert.ok(roleDefStep, 'Should include process-role-definitions step');
    assert.ok(roleDefStep.args.includes('role-definitions.csv'));
  });

  await test('omits process-role-definitions step when not configured', () => {
    const plan = generateMigrationPlan({
      source: 'custom',
      customCsvPath: 'users.csv',
      importMode: 'single-org',
      orgId: 'org_123',
      scale: 'small',
      enableCheckpointing: false,
      validateCsv: true,
      logErrors: true,
    });

    const roleDefStep = plan.steps.find(s => s.id === 'process-role-definitions');
    assert.ok(!roleDefStep, 'Should not include process-role-definitions step');
  });

  // --- Clerk transform step with roles ---
  console.log('\nClerk transform step:');

  await test('adds --role-mapping to Clerk transform step', () => {
    const plan = generateMigrationPlan({
      source: 'clerk',
      clerkCsvPath: 'clerk-export.csv',
      importMode: 'multi-org',
      clerkOrgMappingPath: 'org-mapping.csv',
      scale: 'small',
      enableCheckpointing: false,
      validateCsv: true,
      logErrors: true,
      hasRoleMapping: true,
      roleMappingPath: 'user-role-mapping.csv',
    });

    const transformStep = plan.steps.find(s => s.id === 'clerk-transform');
    assert.ok(transformStep, 'Should include clerk-transform step');
    assert.ok(transformStep.args.includes('--role-mapping'), 'Transform step should have --role-mapping');
    assert.ok(transformStep.args.includes('user-role-mapping.csv'));
  });

  await test('does NOT add --role-mapping to import step for Clerk', () => {
    const plan = generateMigrationPlan({
      source: 'clerk',
      clerkCsvPath: 'clerk-export.csv',
      importMode: 'multi-org',
      clerkOrgMappingPath: 'org-mapping.csv',
      scale: 'small',
      enableCheckpointing: false,
      validateCsv: true,
      logErrors: true,
      hasRoleMapping: true,
      roleMappingPath: 'user-role-mapping.csv',
    });

    const importStep = plan.steps.find(s => s.id === 'import');
    assert.ok(importStep, 'Should include import step');
    assert.ok(!importStep.args.includes('--role-mapping'),
      'Import step should NOT have --role-mapping for Clerk (roles are in transformed CSV)');
  });

  // --- Non-Clerk import step with roles ---
  console.log('\nNon-Clerk import step:');

  await test('adds --role-mapping to import step for non-Clerk source', () => {
    const plan = generateMigrationPlan({
      source: 'custom',
      customCsvPath: 'users.csv',
      importMode: 'single-org',
      orgId: 'org_123',
      scale: 'small',
      enableCheckpointing: false,
      validateCsv: true,
      logErrors: true,
      hasRoleMapping: true,
      roleMappingPath: 'user-role-mapping.csv',
    });

    const importStep = plan.steps.find(s => s.id === 'import');
    assert.ok(importStep, 'Should include import step');
    assert.ok(importStep.args.includes('--role-mapping'), 'Import step should have --role-mapping');
    assert.ok(importStep.args.includes('user-role-mapping.csv'));

    const dryRunStep = plan.steps.find(s => s.id === 'dry-run');
    // Dry run only present when runDryRunFirst is true
  });

  await test('adds --role-mapping to plan step for non-Clerk source', () => {
    const plan = generateMigrationPlan({
      source: 'custom',
      customCsvPath: 'users.csv',
      importMode: 'single-org',
      orgId: 'org_123',
      scale: 'small',
      enableCheckpointing: false,
      validateCsv: true,
      logErrors: true,
      hasRoleMapping: true,
      roleMappingPath: 'user-role-mapping.csv',
    });

    const planStep = plan.steps.find(s => s.id === 'plan');
    assert.ok(planStep, 'Should include plan step');
    assert.ok(planStep.args.includes('--role-mapping'), 'Plan step should have --role-mapping');
  });

  await test('adds --role-mapping to dry-run step for non-Clerk source', () => {
    const plan = generateMigrationPlan({
      source: 'custom',
      customCsvPath: 'users.csv',
      importMode: 'single-org',
      orgId: 'org_123',
      scale: 'small',
      enableCheckpointing: false,
      validateCsv: true,
      logErrors: true,
      runDryRunFirst: true,
      hasRoleMapping: true,
      roleMappingPath: 'user-role-mapping.csv',
    });

    const dryRunStep = plan.steps.find(s => s.id === 'dry-run');
    assert.ok(dryRunStep, 'Should include dry-run step');
    assert.ok(dryRunStep.args.includes('--role-mapping'), 'Dry-run step should have --role-mapping');
  });

  // --- Warnings and recommendations ---
  console.log('\nWarnings and recommendations:');

  await test('warns when role mapping provided without definitions', () => {
    const plan = generateMigrationPlan({
      source: 'custom',
      customCsvPath: 'users.csv',
      importMode: 'single-org',
      orgId: 'org_123',
      scale: 'small',
      enableCheckpointing: false,
      validateCsv: true,
      logErrors: true,
      hasRoleMapping: true,
      roleMappingPath: 'user-role-mapping.csv',
    });

    assert.ok(
      plan.warnings.some(w => w.includes('role definitions') || w.includes('roles must already exist')),
      'Should warn about missing role definitions'
    );
  });

  await test('no warning when both role mapping and definitions provided', () => {
    const plan = generateMigrationPlan({
      source: 'custom',
      customCsvPath: 'users.csv',
      importMode: 'single-org',
      orgId: 'org_123',
      scale: 'small',
      enableCheckpointing: false,
      validateCsv: true,
      logErrors: true,
      hasRoleMapping: true,
      hasRoleDefinitions: true,
      roleDefinitionsPath: 'role-definitions.csv',
      roleMappingPath: 'user-role-mapping.csv',
    });

    assert.ok(
      !plan.warnings.some(w => w.includes('roles must already exist')),
      'Should not warn about missing role definitions when provided'
    );
  });

  await test('recommends role assignments when mapping provided', () => {
    const plan = generateMigrationPlan({
      source: 'custom',
      customCsvPath: 'users.csv',
      importMode: 'single-org',
      orgId: 'org_123',
      scale: 'small',
      enableCheckpointing: false,
      validateCsv: true,
      logErrors: true,
      hasRoleMapping: true,
      roleMappingPath: 'user-role-mapping.csv',
    });

    assert.ok(
      plan.recommendations.some(r => r.includes('Role assignments')),
      'Should recommend about role assignments'
    );
  });

  // Summary
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
