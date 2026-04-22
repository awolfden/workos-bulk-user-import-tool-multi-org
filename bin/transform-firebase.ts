/**
 * Transform Firebase Auth JSON Export to WorkOS Format
 *
 * Reads a Firebase Auth JSON export (from `firebase auth:export --format=JSON`)
 * and optional organization/role mapping CSVs, then produces a WorkOS-compatible
 * CSV ready for validation and import.
 */

import { Command } from 'commander';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { transformFirebaseExport } from '../src/transformers/firebase/firebaseTransformer.js';
import type { FirebaseScryptParams } from '../src/transformers/firebase/phcEncoder.js';
import { ensureOutputDir } from '../src/outputDir.js';

export function registerCommand(parent: Command) {
  parent
    .command('transform-firebase')
    .description('Transform Firebase Auth JSON export to WorkOS-compatible CSV format')
    .requiredOption('--firebase-json <path>', 'Path to Firebase JSON export file')
    .requiredOption('--output <path>', 'Path to output WorkOS CSV file')
    .option('--signer-key <key>', 'Firebase scrypt signer key (base64)')
    .option('--salt-separator <sep>', 'Firebase scrypt salt separator (base64)', 'Bw==')
    .option('--rounds <n>', 'Firebase scrypt rounds', '8')
    .option('--mem-cost <n>', 'Firebase scrypt memory cost', '14')
    .option('--name-split <strategy>', 'Name splitting strategy: first-space, last-space, first-name-only', 'first-space')
    .option('--include-disabled', 'Include disabled users in output')
    .option('--org-mapping <path>', 'Path to organization mapping CSV (firebase_uid → org)')
    .option('--role-mapping <path>', 'Path to user-role mapping CSV (firebase_uid → role_slug)')
    .option('--skipped-users <path>', 'Path for skipped user records (JSONL)', 'output/firebase-skipped-users.jsonl')
    .option('--quiet', 'Suppress output messages')
    .action(async (opts) => {
      await main(opts);
    });
}

async function main(opts: {
  firebaseJson: string;
  output: string;
  signerKey?: string;
  saltSeparator: string;
  rounds: string;
  memCost: string;
  nameSplit: string;
  includeDisabled?: boolean;
  orgMapping?: string;
  roleMapping?: string;
  skippedUsers: string;
  quiet?: boolean;
}) {
  ensureOutputDir();
  const startTime = Date.now();

  if (!opts.quiet) {
    console.log('Firebase → WorkOS Transform Tool');
    console.log('=================================\n');
  }

  // Validate input file exists
  const firebaseJsonPath = path.resolve(opts.firebaseJson);
  if (!existsSync(firebaseJsonPath)) {
    console.error(`Error: Firebase JSON file not found: ${firebaseJsonPath}`);
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

  // Validate name split strategy
  const validStrategies = ['first-space', 'last-space', 'first-name-only'];
  if (!validStrategies.includes(opts.nameSplit)) {
    console.error(`Error: Invalid name split strategy "${opts.nameSplit}". Must be one of: ${validStrategies.join(', ')}`);
    process.exit(1);
  }

  // Build scrypt params if signer key provided
  let scryptParams: FirebaseScryptParams | undefined;
  if (opts.signerKey) {
    scryptParams = {
      signerKey: opts.signerKey,
      saltSeparator: opts.saltSeparator,
      rounds: parseInt(opts.rounds, 10),
      memCost: parseInt(opts.memCost, 10),
    };
  }

  if (!opts.quiet) {
    console.log(`Firebase JSON: ${firebaseJsonPath}`);
    console.log(`Output:        ${path.resolve(opts.output)}`);
    console.log(`Name split:    ${opts.nameSplit}`);
    console.log(`Passwords:     ${scryptParams ? 'Yes (firebase-scrypt → PHC format)' : 'No (signer key not provided)'}`);
    if (opts.includeDisabled) {
      console.log(`Disabled:      Including disabled users`);
    }
    if (opts.orgMapping) {
      console.log(`Org mapping:   ${path.resolve(opts.orgMapping)}`);
    }
    if (opts.roleMapping) {
      console.log(`Role mapping:  ${path.resolve(opts.roleMapping)}`);
    }
    console.log('');
  }

  // Run transformation
  try {
    const summary = await transformFirebaseExport({
      firebaseJsonPath,
      outputPath: path.resolve(opts.output),
      scryptParams,
      nameSplitStrategy: opts.nameSplit as 'first-space' | 'last-space' | 'first-name-only',
      includeDisabled: opts.includeDisabled,
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
      if (summary.disabledUsersSkipped > 0) {
        console.log(`Disabled (skipped):     ${summary.disabledUsersSkipped}`);
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
