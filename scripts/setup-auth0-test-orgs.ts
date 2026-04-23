#!/usr/bin/env node
/**
 * Setup script for Auth0 test organizations
 * Creates organizations and assigns users based on user_metadata.organization_id
 */

import "dotenv/config";
import { Command } from "commander";
import { ManagementClient } from "auth0";

const program = new Command();

program
  .name("setup-auth0-test-orgs")
  .description("Create test organizations in Auth0 and assign users")
  .requiredOption("--domain <domain>", "Auth0 tenant domain")
  .requiredOption("--client-id <id>", "Auth0 Management API client ID")
  .requiredOption("--client-secret <secret>", "Auth0 Management API client secret")
  .parse(process.argv);

interface TestOrganization {
  id: string;
  name: string;
  display_name: string;
}

// Mapping between metadata org IDs and Auth0 org names
const TEST_ORGS: TestOrganization[] = [
  {
    id: "org_acme_001", // metadata organization_id
    name: "acme-corporation", // Auth0 org name
    display_name: "Acme Corporation"
  },
  {
    id: "org_beta_002",
    name: "beta-inc",
    display_name: "Beta Inc"
  },
  {
    id: "org_gamma_003",
    name: "gamma-llc",
    display_name: "Gamma LLC"
  }
];

async function main() {
  const opts = program.opts();

  console.log("Setting up Auth0 test organizations...\n");

  // Initialize Auth0 Management Client
  const client = new ManagementClient({
    domain: opts.domain,
    clientId: opts.clientId,
    clientSecret: opts.clientSecret
  });

  // Step 1: Find or create organizations
  console.log("Step 1: Finding organizations...");
  const createdOrgs: Map<string, string> = new Map(); // metadata_id -> auth0_org_id

  // First, fetch all organizations to find existing ones
  try {
    const allOrgs = await client.organizations.getAll({
      // @ts-ignore - Auth0 SDK types may be outdated
      per_page: 100
    });

    const orgArray = Array.isArray(allOrgs)
      ? allOrgs
      : (allOrgs as any).organizations || [];

    console.log(`  Found ${orgArray.length} total organizations in tenant`);

    // Match organizations by name (case-insensitive, flexible matching)
    for (const testOrg of TEST_ORGS) {
      const existing = orgArray.find(
        (o: any) => {
          const orgName = (o.name || '').toLowerCase();
          const orgDisplayName = (o.display_name || '').toLowerCase();
          const testName = testOrg.name.toLowerCase();
          const testDisplayName = testOrg.display_name.toLowerCase();

          // Match by name, display_name, or close variations
          return orgName === testName ||
                 orgDisplayName === testDisplayName ||
                 orgDisplayName.includes(testDisplayName.split(' ')[0]) || // Match first word
                 orgName.includes(testName.split('-')[0]); // Match first part before hyphen
        }
      );

      if (existing) {
        console.log(`  ✓ Found "${existing.display_name || existing.name}" → maps to metadata org "${testOrg.id}"`);
        console.log(`     Auth0 org ID: ${existing.id}`);
        createdOrgs.set(testOrg.id, existing.id);
      } else {
        console.log(`  ⚠ Organization "${testOrg.display_name}" not found`);
        console.log(`     Expected name: "${testOrg.name}"`);
        console.log(`     Or display_name containing: "${testOrg.display_name}"`);
      }
    }

    if (createdOrgs.size === 0) {
      console.error("\n✗ No matching organizations found!");
      console.error("\nPlease create these organizations in Auth0 Dashboard:");
      console.error("  1. Go to Organizations → Create Organization");
      console.error("  2. Create with these names:\n");
      TEST_ORGS.forEach((org, index) => {
        console.error(`     Organization ${index + 1}:`);
        console.error(`       Name: ${org.name}`);
        console.error(`       Display Name: ${org.display_name}\n`);
      });
      console.error("  Note: 'Name' must be lowercase with only letters, numbers, '-', and '_'");
      console.error("  Note: 'Display Name' can be anything (used for UI display)");
      console.error("\nThen run this script again.");
      process.exit(1);
    }

    if (createdOrgs.size < TEST_ORGS.length) {
      console.log(`\n  ⚠ Warning: Only found ${createdOrgs.size} of ${TEST_ORGS.length} organizations`);
      console.log(`  Missing organizations will be skipped during user assignment\n`);
    }

  } catch (error: any) {
    if (error.statusCode === 404) {
      console.error("\n✗ Organizations API not available (404 error)");
      console.error("\nThis usually means:");
      console.error("  1. Your Auth0 plan doesn't include Organizations (Enterprise feature)");
      console.error("  2. Organizations feature is not enabled on your tenant");
      console.error("\nAlternative: Use metadata-based export with --use-metadata flag");
      process.exit(1);
    }
    console.error(`  ✗ Failed to fetch organizations`);
    console.error(`     Status: ${error.statusCode || 'unknown'}`);
    console.error(`     Message: ${error.message}`);
    throw error;
  }

  console.log();

  // Step 2: Fetch all users and assign to organizations
  console.log("Step 2: Assigning users to organizations...");

  let page = 0;
  let hasMoreUsers = true;
  let totalAssigned = 0;
  let alreadyAssigned = 0;

  while (hasMoreUsers) {
    // Fetch users page
    const users = await client.users.getAll({
      // @ts-ignore
      per_page: 100,
      page
    });

    const userArray = Array.isArray(users)
      ? users
      : (users as any).users || [];

    if (userArray.length === 0) {
      hasMoreUsers = false;
      break;
    }

    // Process each user
    for (const user of userArray) {
      try {
        // Get organization ID from user_metadata
        const orgMetadataId = (user as any).user_metadata?.organization_id;

        if (!orgMetadataId) {
          continue; // Skip users without org metadata
        }

        // Get Auth0 org ID
        const auth0OrgId = createdOrgs.get(orgMetadataId);

        if (!auth0OrgId) {
          console.log(`  ⚠ User ${user.email} has unknown org: ${orgMetadataId}`);
          continue;
        }

        // Check if user is already a member
        try {
          const members = await client.organizations.getMembers({
            id: auth0OrgId,
            // @ts-ignore
            per_page: 100
          });

          const memberArray = Array.isArray(members)
            ? members
            : (members as any).members || [];

          const isMember = memberArray.some(
            (m: any) => m.user_id === user.user_id
          );

          if (isMember) {
            alreadyAssigned++;
            continue;
          }
        } catch (error: any) {
          // Ignore 404 errors (org has no members yet)
          if (error.statusCode !== 404) {
            throw error;
          }
        }

        // Add user to organization
        await client.organizations.addMembers(
          { id: auth0OrgId },
          { members: [user.user_id] }
        );

        const orgName = TEST_ORGS.find(o => o.id === orgMetadataId)?.display_name;
        console.log(`  ✓ Added ${user.email} to ${orgName}`);
        totalAssigned++;
      } catch (error: any) {
        console.error(`  ✗ Failed to assign ${user.email}: ${error.message}`);
      }
    }

    if (userArray.length < 100) {
      hasMoreUsers = false;
    } else {
      page++;
    }
  }

  console.log();
  console.log("=".repeat(60));
  console.log("Setup Complete");
  console.log("=".repeat(60));
  console.log(`Organizations created: ${createdOrgs.size}`);
  console.log(`Users assigned: ${totalAssigned}`);
  console.log(`Users already assigned: ${alreadyAssigned}`);
  console.log();
  console.log("Next step: Run the exporter to test:");
  console.log();
  console.log("  npx tsx bin/export-auth0.ts \\");
  console.log(`    --domain ${opts.domain} \\`);
  console.log(`    --client-id ${opts.clientId} \\`);
  console.log(`    --client-secret YOUR_SECRET \\`);
  console.log("    --output test-export.csv");
  console.log();
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("\nSetup failed:", err.message);
    process.exit(1);
  });
