/**
 * Quick test script for CSV scanner utility
 * Tests pre-warming organization extraction
 */

import { extractUniqueOrganizations } from '../src/utils/csvScanner.js';

async function main() {
  const csvPath = process.argv[2] || 'users-validated.csv';

  console.log(`Testing CSV scanner on: ${csvPath}`);
  console.log('---');

  const startTime = Date.now();

  try {
    const orgs = await extractUniqueOrganizations(csvPath);
    const duration = Date.now() - startTime;

    console.log(`✓ Scan completed in ${duration}ms`);
    console.log(`✓ Found ${orgs.length} unique organizations`);
    console.log('---');

    // Show first 10 orgs
    console.log('First 10 organizations:');
    for (let i = 0; i < Math.min(10, orgs.length); i++) {
      const org = orgs[i];
      console.log(`  ${i + 1}. ${org.orgExternalId} → "${org.orgName || '(no name)'}"`);
    }

    // Count orgs with and without names
    const withNames = orgs.filter(o => o.orgName).length;
    const withoutNames = orgs.length - withNames;

    console.log('---');
    console.log(`Organizations with org_name: ${withNames}`);
    console.log(`Organizations without org_name: ${withoutNames}`);

  } catch (err: any) {
    console.error(`✗ Error: ${err.message}`);
    process.exit(1);
  }
}

main();
