#!/usr/bin/env node
/**
 * Test organization lookup by external_id
 *
 * Usage: npx tsx scripts/test-org-lookup.ts org_e5zUSU9XK17b5ytC
 */

import 'dotenv/config';
import { WorkOS } from '@workos-inc/node';
import { getWorkOSClient } from '../src/workos.js';

const externalId = process.argv[2];

if (!externalId) {
  console.error('Usage: npx tsx scripts/test-org-lookup.ts <external_id>');
  process.exit(1);
}

async function testLookup() {
  const workos = getWorkOSClient() as WorkOS;

  console.log(`Testing lookup for external_id: ${externalId}\n`);

  // Test 1: Try getOrganizationByExternalId
  console.log('Test 1: Using getOrganizationByExternalId()');
  try {
    const org = await (workos as any).organizations.getOrganizationByExternalId(externalId);
    console.log('✓ Found organization:');
    console.log(`  ID: ${org.id}`);
    console.log(`  Name: ${org.name}`);
    console.log(`  External ID: ${org.externalId}`);
  } catch (err: any) {
    console.log(`✗ Error: ${err.message}`);
    console.log(`  Status: ${err.status || err.code || 'unknown'}`);
  }

  // Test 2: Try listing organizations with external_id filter
  console.log('\nTest 2: Listing organizations (first 10)');
  try {
    const { data: orgs } = await (workos as any).organizations.listOrganizations({
      limit: 10
    });
    console.log(`Found ${orgs.length} organizations:`);
    for (const org of orgs) {
      if (org.externalId === externalId) {
        console.log(`  ✓ MATCH: ${org.id} - ${org.name} - external_id: ${org.externalId}`);
      } else {
        console.log(`    ${org.id} - ${org.name} - external_id: ${org.externalId || '(none)'}`);
      }
    }
  } catch (err: any) {
    console.log(`✗ Error: ${err.message}`);
  }

  // Test 3: Try creating organization with this external_id
  console.log('\nTest 3: Attempting to create organization with this external_id');
  try {
    const org = await (workos as any).organizations.createOrganization({
      name: 'Test Create ' + Date.now(),
      externalId: externalId
    });
    console.log('✓ Created (unexpected!):');
    console.log(`  ID: ${org.id}`);
  } catch (err: any) {
    console.log(`✗ Error (expected): ${err.message}`);
    if (err.message.includes('already been assigned')) {
      console.log('  → This confirms the external_id IS in use');
    }
  }
}

testLookup().catch(console.error);
