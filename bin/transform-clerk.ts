/**
 * Transform Clerk CSV Export to WorkOS Format
 *
 * Reads a Clerk user CSV export and an optional organization mapping CSV,
 * then produces a WorkOS-compatible CSV ready for validation and import.
 */

import { Command } from 'commander';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { transformClerkExport } from '../src/transformers/clerk/clerkTransformer.js';
import { ensureOutputDir } from '../src/outputDir.js';

export function registerCommand(parent: Command) {
  parent
    .command('transform-clerk')
    .description('Transform Clerk CSV export to WorkOS-compatible CSV format')
    .requiredOption('--clerk-csv <path>', 'Path to Clerk CSV export file')
    .requiredOption('--output <path>', 'Path to output WorkOS CSV file')
    .option('--org-mapping <path>', 'Path to organization mapping CSV (clerk_user_id → org)')
    .option('--role-mapping <path>', 'Path to user-role mapping CSV (clerk_user_id → role_slug)')
    .option('--skipped-users <path>', 'Path for skipped user records (JSONL)', 'output/clerk-skipped-users.jsonl')
    .option('--quiet', 'Suppress output messages')
    .action(async (opts) => {
      await main(opts);
    });
}

async function main(opts: {
  clerkCsv: string;
  output: string;
  orgMapping?: string;
  roleMapping?: string;
  skippedUsers: string;
  quiet?: boolean;
}) {
  const startTime = Date.now();

  ensureOutputDir();

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

  if (opts.roleMapping) {
    const roleMappingPath = path.resolve(opts.roleMapping);
    if (!existsSync(roleMappingPath)) {
      console.error(`Error: Role mapping file not found: ${roleMappingPath}`);
      process.exit(1);
    }
  }

  if (!opts.quiet) {
    console.log(`Clerk CSV:    ${clerkCsvPath}`);
    console.log(`Output:       ${path.resolve(opts.output)}`);
    if (opts.orgMapping) {
      console.log(`Org mapping:  ${path.resolve(opts.orgMapping)}`);
    }
    if (opts.roleMapping) {
      console.log(`Role mapping: ${path.resolve(opts.roleMapping)}`);
    }
    console.log('');
  }

  // Run transformation
  try {
    const summary = await transformClerkExport({
      clerkCsvPath,
      outputPath: path.resolve(opts.output),
      orgMappingPath: opts.orgMapping ? path.resolve(opts.orgMapping) : undefined,
      roleMappingPath: opts.roleMapping ? path.resolve(opts.roleMapping) : undefined,
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
      if (opts.roleMapping) {
        console.log(`With role mapping:      ${summary.usersWithRoleMapping}`);
      }

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
      console.log(`  1. Validate: npx workos-migrate validate --csv ${path.resolve(opts.output)} --auto-fix --fixed-csv output/users-validated.csv`);
      console.log(`  2. Import:   npx workos-migrate import --csv output/users-validated.csv`);
      console.log('');
    }

    process.exit(0);
  } catch (err: any) {
    console.error(`\nError: ${err?.message || String(err)}`);
    process.exit(1);
  }
}
