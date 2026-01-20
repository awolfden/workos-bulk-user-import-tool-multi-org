#!/usr/bin/env tsx
/**
 * Clean up test data from Auth0
 * Deletes all organizations and users created by create-auth0-test-data.ts
 */

import 'dotenv/config';
import { Command } from 'commander';
import { Auth0Client } from '../src/exporters/auth0/auth0Client.js';
import type { Auth0Credentials } from '../src/exporters/types.js';

const program = new Command();

program
  .name('cleanup-auth0-test-data')
  .description('Delete test organizations and users from Auth0')
  .requiredOption('--domain <domain>', 'Auth0 tenant domain')
  .requiredOption('--client-id <id>', 'Auth0 Management API client ID')
  .requiredOption('--client-secret <secret>', 'Auth0 Management API client secret')
  .requiredOption('--prefix <prefix>', 'Prefix used when creating test data')
  .option('--yes', 'Skip confirmation prompt', false)
  .parse(process.argv);

interface CleanupOptions {
  domain: string;
  clientId: string;
  clientSecret: string;
  prefix: string;
  yes: boolean;
}

async function main() {
  const opts = program.opts<CleanupOptions>();

  console.log('\n' + '='.repeat(60));
  console.log('AUTH0 TEST DATA CLEANUP');
  console.log('='.repeat(60));
  console.log(`Domain:  ${opts.domain}`);
  console.log(`Prefix:  ${opts.prefix}`);
  console.log('='.repeat(60) + '\n');

  // Create Auth0 client
  const credentials: Auth0Credentials = {
    type: 'auth0',
    domain: opts.domain,
    clientId: opts.clientId,
    clientSecret: opts.clientSecret
  };

  const client = new Auth0Client(credentials, 50);

  try {
    // Test connection
    console.log('Testing Auth0 connection...');
    const test = await client.testConnection();
    if (!test.success) {
      throw new Error(test.error || 'Connection test failed');
    }
    console.log('✓ Connected to Auth0\n');

    // Find all test organizations
    console.log(`Finding organizations with prefix "${opts.prefix}"...`);
    const allOrgs = [];
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const orgs = await client.getOrganizations(page, 100);
      if (orgs.length === 0) {
        hasMore = false;
        break;
      }

      const testOrgs = orgs.filter(org => org.name.startsWith(opts.prefix));
      allOrgs.push(...testOrgs);

      if (orgs.length < 100) {
        hasMore = false;
      } else {
        page++;
      }
    }

    console.log(`Found ${allOrgs.length} test organizations\n`);

    // Find all test users
    console.log(`Finding users with prefix "${opts.prefix}"...`);
    const allUsers = [];
    page = 0;
    hasMore = true;

    while (hasMore) {
      const users = await client.getUsers(page, 100);
      if (users.length === 0) {
        hasMore = false;
        break;
      }

      const testUsers = users.filter(
        user => user.email && user.email.startsWith(opts.prefix)
      );
      allUsers.push(...testUsers);

      if (users.length < 100) {
        hasMore = false;
      } else {
        page++;
      }
    }

    console.log(`Found ${allUsers.length} test users\n`);

    if (allOrgs.length === 0 && allUsers.length === 0) {
      console.log('✓ No test data found to clean up');
      client.stop();
      process.exit(0);
    }

    // Confirm deletion
    if (!opts.yes) {
      console.log('⚠️  WARNING: This will permanently delete:');
      console.log(`   - ${allOrgs.length} organizations`);
      console.log(`   - ${allUsers.length} users`);
      console.log('\nType "yes" to confirm: ');

      // Read from stdin
      const readline = await import('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      await new Promise<void>((resolve, reject) => {
        rl.question('', (answer) => {
          rl.close();
          if (answer.toLowerCase() !== 'yes') {
            console.log('\nAborted');
            client.stop();
            process.exit(0);
          }
          resolve();
        });
      });
    }

    const startTime = Date.now();

    // Delete organizations
    if (allOrgs.length > 0) {
      console.log(`\nDeleting ${allOrgs.length} organizations...`);
      let deleted = 0;
      let failed = 0;

      for (const org of allOrgs) {
        try {
          const response = await client.makeApiCall(
            `/api/v2/organizations/${org.id}`,
            {
              method: 'DELETE'
            }
          );

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          deleted++;

          if (deleted % 10 === 0 || deleted === allOrgs.length) {
            console.log(`  Deleted ${deleted}/${allOrgs.length} organizations`);
          }
        } catch (error: any) {
          failed++;
          if (failed <= 5) {
            console.error(`  ✗ Failed to delete ${org.name}: ${error.message}`);
          }
        }
      }

      console.log(`✓ Deleted ${deleted} organizations (${failed} failed)`);
    }

    // Delete users
    if (allUsers.length > 0) {
      console.log(`\nDeleting ${allUsers.length} users...`);
      let deleted = 0;
      let failed = 0;

      for (const user of allUsers) {
        try {
          const response = await client.makeApiCall(
            `/api/v2/users/${encodeURIComponent(user.user_id)}`,
            {
              method: 'DELETE'
            }
          );

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          deleted++;

          if (deleted % 100 === 0 || deleted === allUsers.length) {
            const rate = deleted / ((Date.now() - startTime) / 1000);
            console.log(
              `  Deleted ${deleted}/${allUsers.length} users ` +
              `(${rate.toFixed(1)} users/sec)`
            );
          }
        } catch (error: any) {
          failed++;
          if (failed <= 5) {
            console.error(`  ✗ Failed to delete ${user.email}: ${error.message}`);
          }
        }
      }

      console.log(`✓ Deleted ${deleted} users (${failed} failed)`);
    }

    const duration = (Date.now() - startTime) / 1000;

    console.log('\n' + '='.repeat(60));
    console.log('CLEANUP COMPLETE');
    console.log('='.repeat(60));
    console.log(`Organizations deleted: ${allOrgs.length}`);
    console.log(`Users deleted:         ${allUsers.length}`);
    console.log(`Duration:              ${duration.toFixed(1)}s`);
    console.log('='.repeat(60) + '\n');

    client.stop();
    process.exit(0);
  } catch (error: any) {
    console.error(`\n❌ Fatal error: ${error.message}`);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    client.stop();
    process.exit(1);
  }
}

main();
