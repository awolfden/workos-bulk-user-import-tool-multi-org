#!/usr/bin/env node
/**
 * Transform Clerk CSV Export to WorkOS Format
 *
 * Reads a Clerk user CSV export and an optional organization mapping CSV,
 * then produces a WorkOS-compatible CSV ready for validation and import.
 *
 * CLERK CSV FORMAT (standard Clerk user export):
 *   id,first_name,last_name,username,primary_email_address,primary_phone_number,
 *   verified_email_addresses,unverified_email_addresses,verified_phone_numbers,
 *   unverified_phone_numbers,totp_secret,password_digest,password_hasher
 *
 * ORG MAPPING CSV FORMAT:
 *   Must have a 'clerk_user_id' column plus one or more org columns:
 *
 *   clerk_user_id,org_id
 *     → Use when orgs already exist in WorkOS (direct lookup by org ID)
 *
 *   clerk_user_id,org_external_id,org_name
 *     → Use when orgs may need to be created during import
 *       (the importer auto-creates orgs with the given name and external_id)
 *
 *   clerk_user_id,org_external_id
 *     → Use when orgs already exist in WorkOS (lookup by external ID;
 *       import fails if org not found)
 *
 *   clerk_user_id,org_name
 *     → Use when orgs should be looked up or created by name
 *
 * NOTE: Organization creation happens during the *import* step, not this
 * transform step. This tool maps org columns into the output CSV. The existing
 * import pipeline (import-users / orchestrate-migration) handles org lookups,
 * caching, pre-warming, and auto-creation.
 *
 * PASSWORD HANDLING:
 *   Only bcrypt password hashes are supported. Users with other hash types
 *   (argon2, scrypt, pbkdf2) will have their password fields omitted and
 *   will need to reset their password on first login.
 *
 * Usage:
 *   npx tsx bin/transform-clerk.ts \
 *     --clerk-csv clerk-export.csv \
 *     --output workos-users.csv
 *
 *   npx tsx bin/transform-clerk.ts \
 *     --clerk-csv clerk-export.csv \
 *     --org-mapping user-org-mapping.csv \
 *     --output workos-users.csv
 */

import { Command } from 'commander';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { transformClerkExport } from '../src/transformers/clerk/clerkTransformer.js';

const program = new Command();

program
  .name('transform-clerk')
  .description('Transform Clerk CSV export to WorkOS-compatible CSV format')
  .requiredOption('--clerk-csv <path>', 'Path to Clerk CSV export file')
  .requiredOption('--output <path>', 'Path to output WorkOS CSV file')
  .option('--org-mapping <path>', 'Path to organization mapping CSV (clerk_user_id → org)')
  .option('--skipped-users <path>', 'Path for skipped user records (JSONL)', 'clerk-skipped-users.jsonl')
  .option('--quiet', 'Suppress output messages')
  .parse(process.argv);

const opts = program.opts<{
  clerkCsv: string;
  output: string;
  orgMapping?: string;
  skippedUsers: string;
  quiet?: boolean;
}>();

async function main() {
  const startTime = Date.now();

  if (!opts.quiet) {
    console.log('Clerk → WorkOS Transform Tool');
    console.log('===============================\n');
  }

  // Validate input files exist
  const clerkCsvPath = path.resolve(opts.clerkCsv);
  if (!existsSync(clerkCsvPath)) {
    console.error(`Error: Clerk CSV file not found: ${clerkCsvPath}`);
    process.exit(1);
  }

  if (opts.orgMapping) {
    const orgMappingPath = path.resolve(opts.orgMapping);
    if (!existsSync(orgMappingPath)) {
      console.error(`Error: Org mapping file not found: ${orgMappingPath}`);
      process.exit(1);
    }
  }

  if (!opts.quiet) {
    console.log(`Clerk CSV:    ${clerkCsvPath}`);
    console.log(`Output:       ${path.resolve(opts.output)}`);
    if (opts.orgMapping) {
      console.log(`Org mapping:  ${path.resolve(opts.orgMapping)}`);
    }
    console.log('');
  }

  // Run transformation
  try {
    const summary = await transformClerkExport({
      clerkCsvPath,
      outputPath: path.resolve(opts.output),
      orgMappingPath: opts.orgMapping ? path.resolve(opts.orgMapping) : undefined,
      skippedUsersPath: path.resolve(opts.skippedUsers),
      quiet: opts.quiet,
    });

    // Display summary
    if (!opts.quiet) {
      const duration = Date.now() - startTime;

      console.log('\nTransformation Summary');
      console.log('─────────────────────');
      console.log(`Total users:            ${summary.totalUsers}`);
      console.log(`Transformed:            ${summary.transformedUsers}`);
      console.log(`Skipped:                ${summary.skippedUsers}`);
      console.log(`With passwords:         ${summary.usersWithPasswords}`);
      console.log(`Without passwords:      ${summary.usersWithoutPasswords}`);
      console.log(`With org mapping:       ${summary.usersWithOrgMapping}`);
      console.log(`Without org mapping:    ${summary.usersWithoutOrgMapping}`);

      if (Object.keys(summary.skippedReasons).length > 0) {
        console.log('\nSkip/Warning Reasons:');
        for (const [reason, count] of Object.entries(summary.skippedReasons)) {
          console.log(`  ${reason}: ${count}`);
        }
      }

      console.log(`\nCompleted in ${duration}ms`);
      console.log(`Output: ${path.resolve(opts.output)}`);

      if (summary.skippedUsers > 0) {
        console.log(`Skipped users: ${path.resolve(opts.skippedUsers)}`);
      }

      // Next steps
      console.log('\nNext steps:');
      console.log(`  1. Validate: npx tsx bin/validate-csv.ts --csv ${path.resolve(opts.output)} --auto-fix --fixed-csv users-validated.csv`);
      console.log(`  2. Import:   npx tsx bin/import-users.ts --csv users-validated.csv`);
      console.log('');
    }

    process.exit(0);
  } catch (err: any) {
    console.error(`\nError: ${err?.message || String(err)}`);
    process.exit(1);
  }
}

main();
