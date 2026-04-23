#!/usr/bin/env node
/**
 * Quick test script to verify Auth0 Management API connectivity
 * Tests basic user read access
 */

import "dotenv/config";
import { Command } from "commander";
import { ManagementClient } from "auth0";

const program = new Command();

program
  .name("test-auth0-connection")
  .description("Test Auth0 Management API connectivity")
  .requiredOption("--domain <domain>", "Auth0 tenant domain")
  .requiredOption("--client-id <id>", "Auth0 Management API client ID")
  .requiredOption("--client-secret <secret>", "Auth0 Management API client secret")
  .parse(process.argv);

async function main() {
  const opts = program.opts();

  console.log("Testing Auth0 Management API connectivity...\n");
  console.log(`Domain: ${opts.domain}\n`);

  const client = new ManagementClient({
    domain: opts.domain,
    clientId: opts.clientId,
    clientSecret: opts.clientSecret
  });

  // Test 1: Get users
  console.log("Test 1: Reading users...");
  try {
    const users = await client.users.getAll({
      // @ts-ignore
      per_page: 5
    });

    const userArray = Array.isArray(users)
      ? users
      : (users as any).users || [];

    console.log(`✓ Successfully read users`);
    console.log(`  Found ${userArray.length} users (showing first 5)`);

    userArray.forEach((user: any, index: number) => {
      console.log(`    ${index + 1}. ${user.email || user.user_id}`);
    });
    console.log();
  } catch (error: any) {
    console.error(`✗ Failed to read users`);
    console.error(`  Status: ${error.statusCode || 'unknown'}`);
    console.error(`  Message: ${error.message}`);
    console.error("\nCheck that your M2M app has 'read:users' scope\n");
    process.exit(1);
  }

  // Test 2: Get organizations
  console.log("Test 2: Reading organizations...");
  try {
    const orgs = await client.organizations.getAll({
      // @ts-ignore
      per_page: 10
    });

    const orgArray = Array.isArray(orgs)
      ? orgs
      : (orgs as any).organizations || [];

    console.log(`✓ Successfully read organizations`);
    console.log(`  Found ${orgArray.length} organizations`);

    orgArray.forEach((org: any, index: number) => {
      console.log(`    ${index + 1}. ${org.display_name || org.name} (${org.id})`);
    });
    console.log();
  } catch (error: any) {
    if (error.statusCode === 404) {
      console.error(`✗ Organizations API not available (404)`);
      console.error(`  This usually means your Auth0 plan doesn't include Organizations`);
      console.error(`  Organizations is an Enterprise-only feature`);
      console.error(`\n  ℹ Solution: Use --use-metadata flag for exports\n`);
    } else if (error.statusCode === 403) {
      console.error(`✗ Permission denied (403)`);
      console.error(`  Your M2M app needs 'read:organizations' scope`);
      console.error(`  Add this scope in: Applications → Your M2M App → APIs → Auth0 Management API\n`);
    } else {
      console.error(`✗ Failed to read organizations`);
      console.error(`  Status: ${error.statusCode || 'unknown'}`);
      console.error(`  Message: ${error.message}\n`);
    }
  }

  console.log("=".repeat(60));
  console.log("Connection Test Complete");
  console.log("=".repeat(60));
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("\nTest failed:", err.message);
    process.exit(1);
  });
