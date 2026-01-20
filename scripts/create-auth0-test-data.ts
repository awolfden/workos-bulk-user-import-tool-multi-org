#!/usr/bin/env tsx
/**
 * Create test data in Auth0 for end-to-end export testing
 * Uses Auth0 Management API to create organizations and users
 */

import 'dotenv/config';
import { Command } from 'commander';
import { Auth0Client } from '../src/exporters/auth0/auth0Client.js';
import type { Auth0Credentials } from '../src/exporters/types.js';

const program = new Command();

program
  .name('create-auth0-test-data')
  .description('Create test organizations and users in Auth0')
  .requiredOption('--domain <domain>', 'Auth0 tenant domain')
  .requiredOption('--client-id <id>', 'Auth0 Management API client ID')
  .requiredOption('--client-secret <secret>', 'Auth0 Management API client secret')
  .option('--orgs <n>', 'Number of organizations to create', (v) => parseInt(v, 10), 10)
  .option('--users-per-org <n>', 'Number of users per organization', (v) => parseInt(v, 10), 100)
  .option('--prefix <prefix>', 'Prefix for org/user names', 'test')
  .option('--connection <name>', 'Auth0 connection name', 'Username-Password-Authentication')
  .parse(process.argv);

interface CreateOptions {
  domain: string;
  clientId: string;
  clientSecret: string;
  orgs: number;
  usersPerOrg: number;
  prefix: string;
  connection: string;
}

async function main() {
  const opts = program.opts<CreateOptions>();

  const totalUsers = opts.orgs * opts.usersPerOrg;

  console.log('\n' + '='.repeat(60));
  console.log('AUTH0 TEST DATA CREATION');
  console.log('='.repeat(60));
  console.log(`Domain:              ${opts.domain}`);
  console.log(`Organizations:       ${opts.orgs}`);
  console.log(`Users per org:       ${opts.usersPerOrg}`);
  console.log(`Total users:         ${totalUsers}`);
  console.log(`Prefix:              ${opts.prefix}`);
  console.log('='.repeat(60) + '\n');

  if (totalUsers > 25000) {
    console.error('❌ Error: Total users exceeds Auth0 free tier limit (25,000)');
    process.exit(1);
  }

  // Confirm before proceeding
  console.log('⚠️  Warning: This will create real data in your Auth0 tenant!');
  console.log('   Make sure you have a test tenant, not production.\n');

  // Create Auth0 client
  const credentials: Auth0Credentials = {
    type: 'auth0',
    domain: opts.domain,
    clientId: opts.clientId,
    clientSecret: opts.clientSecret
  };

  const client = new Auth0Client(credentials, 50); // 50 rps rate limit

  try {
    // Test connection
    console.log('Testing Auth0 connection...');
    const test = await client.testConnection();
    if (!test.success) {
      throw new Error(test.error || 'Connection test failed');
    }
    console.log('✓ Connected to Auth0\n');

    const startTime = Date.now();
    const createdOrgs: string[] = [];

    // Step 1: Create organizations
    console.log(`Creating ${opts.orgs} organizations...`);
    for (let i = 0; i < opts.orgs; i++) {
      const orgName = `${opts.prefix}-org-${i.toString().padStart(3, '0')}`;

      try {
        // Use Management API with rate limiting
        const response = await client.makeApiCall('/api/v2/organizations', {
          method: 'POST',
          body: JSON.stringify({
            name: orgName,
            display_name: `Test Organization ${i}`
          })
        });

        if (!response.ok) {
          const error = await response.text();
          throw new Error(`Failed to create org: ${error}`);
        }

        const org = await response.json();
        createdOrgs.push(org.id);

        if ((i + 1) % 5 === 0 || i === opts.orgs - 1) {
          console.log(`  Created ${i + 1}/${opts.orgs} organizations`);
        }
      } catch (error: any) {
        console.error(`  ✗ Failed to create ${orgName}: ${error.message}`);
      }
    }

    console.log(`✓ Created ${createdOrgs.length} organizations\n`);

    // Step 2: Create users and add to organizations
    console.log(`Creating ${totalUsers} users...`);
    let usersCreated = 0;
    let usersFailed = 0;
    const failedUsers: Array<{
      userNum: number;
      email: string;
      orgId: string;
      error: string;
      timestamp: string;
    }> = [];

    for (let orgIdx = 0; orgIdx < createdOrgs.length; orgIdx++) {
      const orgId = createdOrgs[orgIdx];

      for (let userIdx = 0; userIdx < opts.usersPerOrg; userIdx++) {
        const userNum = orgIdx * opts.usersPerOrg + userIdx;
        const email = `${opts.prefix}-user-${userNum.toString().padStart(5, '0')}@test.workos.com`;

        try {
          // Create user with rate limiting
          const userResponse = await client.makeApiCall('/api/v2/users', {
            method: 'POST',
            body: JSON.stringify({
              email,
              password: 'Test1234!@#$',
              connection: opts.connection,
              email_verified: true,
              name: `Test User ${userNum}`,
              given_name: 'Test',
              family_name: `User ${userNum}`,
              user_metadata: {
                // Test various data types that caused issues in the past
                test_data: true,
                created_for: 'export_testing',
                user_number: userNum,

                // Arrays (these caused metadata_required errors before fix)
                roles: ['user', 'viewer', 'member'],
                permissions: ['read', 'write'],
                favorite_numbers: [1, 2, 3, userNum],

                // Nested objects
                preferences: {
                  theme: 'dark',
                  notifications: true,
                  language: 'en'
                },

                // Mixed nested structure
                profile: {
                  bio: 'Test user bio',
                  tags: ['test', 'export', 'qa'],
                  settings: {
                    email_notifications: true,
                    sms_notifications: false
                  }
                },

                // Empty arrays and objects
                empty_array: [],
                empty_object: {},

                // Various types
                is_active: true,
                age: 25 + (userNum % 50),
                score: 98.5,
                last_login: new Date().toISOString()
              },
              app_metadata: {
                department: userIdx % 3 === 0 ? 'Engineering' : userIdx % 3 === 1 ? 'Sales' : 'Marketing',
                role: userIdx % 3 === 0 ? 'admin' : 'user',

                // Complex app metadata with arrays
                team_memberships: [`team_${orgIdx}`, 'team_global'],
                feature_flags: {
                  new_ui: true,
                  beta_features: userIdx % 5 === 0,
                  experimental: ['feature_a', 'feature_b']
                },

                // Nested permissions structure
                permissions: {
                  admin: userIdx % 3 === 0,
                  resources: {
                    projects: ['read', 'write'],
                    users: userIdx % 3 === 0 ? ['read', 'write', 'delete'] : ['read']
                  }
                },

                // Numbers and dates
                employee_id: 10000 + userNum,
                hire_date: new Date('2020-01-01').toISOString(),
                salary_band: userIdx % 3 + 1
              }
            })
          });

          if (!userResponse.ok) {
            const error = await userResponse.text();
            throw new Error(`Failed to create user: ${error}`);
          }

          const user = await userResponse.json();

          // Add user to organization with rate limiting
          const memberResponse = await client.makeApiCall(
            `/api/v2/organizations/${orgId}/members`,
            {
              method: 'POST',
              body: JSON.stringify({
                members: [user.user_id]
              })
            }
          );

          if (!memberResponse.ok) {
            console.error(`  ⚠ Created user ${email} but failed to add to org`);
          }

          usersCreated++;

          // Progress update every 100 users
          if (usersCreated % 100 === 0) {
            const elapsed = (Date.now() - startTime) / 1000;
            const rate = usersCreated / elapsed;
            const remaining = totalUsers - usersCreated;
            const eta = remaining / rate;

            console.log(
              `  Created ${usersCreated}/${totalUsers} users ` +
              `(${rate.toFixed(1)} users/sec, ETA: ${Math.ceil(eta)}s)`
            );
          }
        } catch (error: any) {
          usersFailed++;

          // Record failure details
          failedUsers.push({
            userNum,
            email,
            orgId,
            error: error.message || String(error),
            timestamp: new Date().toISOString()
          });

          // Print first 10 failures to console
          if (usersFailed <= 10) {
            console.error(`  ✗ Failed to create user ${userNum} (${email}): ${error.message}`);
          }
        }
      }
    }

    const duration = (Date.now() - startTime) / 1000;

    // Write failure log if there were any failures
    let failureLogPath = '';
    if (failedUsers.length > 0) {
      failureLogPath = `auth0-test-data-failures-${Date.now()}.json`;
      await import('fs/promises').then(fs =>
        fs.writeFile(
          failureLogPath,
          JSON.stringify({
            summary: {
              total_failures: failedUsers.length,
              created_at: new Date().toISOString(),
              domain: opts.domain,
              prefix: opts.prefix
            },
            failures: failedUsers
          }, null, 2)
        )
      );
    }

    console.log('\n' + '='.repeat(60));
    console.log('TEST DATA CREATION COMPLETE');
    console.log('='.repeat(60));
    console.log(`Organizations created: ${createdOrgs.length}`);
    console.log(`Users created:         ${usersCreated}`);
    console.log(`Users failed:          ${usersFailed}`);
    console.log(`Duration:              ${duration.toFixed(1)}s`);
    console.log(`Throughput:            ${(usersCreated / duration).toFixed(1)} users/sec`);
    if (failureLogPath) {
      console.log(`Failure log:           ${failureLogPath}`);
    }
    console.log('='.repeat(60) + '\n');

    console.log('Next steps:');
    console.log('  1. Test export:');
    console.log(`     npx tsx bin/export-auth0.ts \\`);
    console.log(`       --domain ${opts.domain} \\`);
    console.log(`       --client-id <id> \\`);
    console.log(`       --client-secret <secret> \\`);
    console.log(`       --output test-export.csv \\`);
    console.log(`       --job-id test-export-${Date.now()}`);
    console.log('');
    console.log('  2. Clean up test data:');
    console.log(`     npx tsx scripts/cleanup-auth0-test-data.ts \\`);
    console.log(`       --domain ${opts.domain} \\`);
    console.log(`       --client-id <id> \\`);
    console.log(`       --client-secret <secret> \\`);
    console.log(`       --prefix ${opts.prefix}`);
    console.log('');

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
