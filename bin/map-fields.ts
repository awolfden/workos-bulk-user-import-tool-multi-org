#!/usr/bin/env node
/**
 * Phase 3: Field Mapper - CLI Entry Point
 *
 * Transform CSV files from provider format to WorkOS format.
 *
 * Usage:
 *   npx tsx bin/map-fields.ts --input auth0-export.csv --output workos-ready.csv --profile auth0
 *   npx tsx bin/map-fields.ts --list-profiles
 */

import 'dotenv/config';
import { Command } from 'commander';
import chalk from 'chalk';
import { FieldMapper } from '../src/mapper/fieldMapper.js';
import { loadProfile, listBuiltInProfiles, getProfileInfo } from '../src/mapper/profiles/index.js';

const program = new Command();

program
  .name('map-fields')
  .description('Transform CSV files from provider format to WorkOS format')
  .version('1.0.0');

program
  .option('--input <path>', 'Input CSV file path')
  .option('--output <path>', 'Output CSV file path')
  .option('--profile <name|path>', 'Profile name (auth0) or path to custom JSON profile')
  .option('--quiet', 'Suppress progress output')
  .option('--validate', 'Validate output CSV after mapping (using Phase 2 validator)')
  .option('--list-profiles', 'List available built-in profiles and exit');

program.parse();
const options = program.opts();

/**
 * Main execution
 */
async function main() {
  try {
    // Handle --list-profiles
    if (options.listProfiles) {
      await listProfiles();
      process.exit(0);
    }

    // Validate required options
    if (!options.input) {
      console.error(chalk.red('Error: --input is required'));
      program.help();
      process.exit(2);
    }
    if (!options.output) {
      console.error(chalk.red('Error: --output is required'));
      program.help();
      process.exit(2);
    }
    if (!options.profile) {
      console.error(chalk.red('Error: --profile is required'));
      program.help();
      process.exit(2);
    }

    // Load profile
    const profile = await loadProfile(options.profile);

    // Display header
    console.log('============================================================');
    console.log('CSV FIELD MAPPER');
    console.log('============================================================');
    console.log(`Profile:         ${profile.name}`);
    console.log(`Description:     ${profile.description}`);
    console.log(`Input:           ${options.input}`);
    console.log(`Output:          ${options.output}`);
    console.log('============================================================\n');

    // Create mapper and transform
    const mapper = new FieldMapper({
      inputPath: options.input,
      outputPath: options.output,
      profile,
      quiet: options.quiet,
      validateAfter: options.validate
    });

    const summary = await mapper.transform();

    // Display summary
    displaySummary(summary, options.output);

    // Exit with appropriate code
    if (summary.errorRows > 0) {
      process.exit(1);  // Completed with errors
    } else {
      process.exit(0);  // Success
    }
  } catch (error) {
    console.error(chalk.red('\n❌ Fatal error:'));
    console.error(error instanceof Error ? error.message : String(error));

    if (error instanceof Error && error.stack && !options.quiet) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }

    process.exit(2);  // Fatal error
  }
}

/**
 * List available built-in profiles
 */
async function listProfiles() {
  console.log(chalk.bold('\nAvailable Built-in Profiles:\n'));

  const profiles = listBuiltInProfiles();
  for (const name of profiles) {
    try {
      const info = await getProfileInfo(name);
      console.log(chalk.cyan(`  ${info.name}`));
      console.log(`    ${info.description}\n`);
    } catch (error) {
      console.log(chalk.cyan(`  ${name}`));
      console.log(chalk.gray(`    (info unavailable)\n`));
    }
  }

  console.log(chalk.gray('To use a built-in profile:'));
  console.log(chalk.gray('  npx tsx bin/map-fields.ts --input input.csv --output output.csv --profile auth0\n'));

  console.log(chalk.gray('To use a custom profile:'));
  console.log(chalk.gray('  npx tsx bin/map-fields.ts --input input.csv --output output.csv --profile ./custom-profile.json\n'));
}

/**
 * Display mapping summary
 */
function displaySummary(summary: any, outputPath: string) {
  console.log('\n============================================================');
  console.log('MAPPING SUMMARY');
  console.log('============================================================');
  console.log(`Total rows:          ${summary.totalRows}`);
  console.log(`Successful rows:     ${summary.successfulRows}`);
  console.log(`Error rows:          ${summary.errorRows}`);
  console.log(`Duration:            ${(summary.durationMs / 1000).toFixed(2)}s`);

  // Show unmapped fields
  const unmappedCount = Object.keys(summary.skippedFields).length;
  if (unmappedCount > 0) {
    console.log(`\nUnmapped source fields (${unmappedCount}):`);
    const sortedFields = Object.entries(summary.skippedFields)
      .sort((a, b) => (b[1] as number) - (a[1] as number))
      .slice(0, 10);  // Show top 10

    for (const [field, count] of sortedFields) {
      console.log(`  - ${field} (${count} rows)`);
    }

    if (unmappedCount > 10) {
      console.log(`  ... and ${unmappedCount - 10} more`);
    }

    console.log(chalk.gray('\nThese fields were not included in the output CSV.'));
    console.log(chalk.gray('To map them, update your profile or use a custom profile.'));
  }

  // Show errors if any
  if (summary.errors.length > 0) {
    console.log(chalk.yellow(`\n⚠️  Errors occurred during mapping (${summary.errors.length}):`));
    const errorSample = summary.errors.slice(0, 5);
    for (const error of errorSample) {
      console.log(chalk.gray(`  Row ${error.recordNumber}: ${error.errorMessage}`));
    }
    if (summary.errors.length > 5) {
      console.log(chalk.gray(`  ... and ${summary.errors.length - 5} more errors`));
    }
  }

  console.log('============================================================\n');

  // Final status
  if (summary.errorRows === 0) {
    console.log(chalk.green('✓ Mapping completed successfully'));
    console.log(`Output: ${outputPath}`);
  } else {
    console.log(chalk.yellow(`⚠️  Mapping completed with ${summary.errorRows} error(s)`));
    console.log(`Output: ${outputPath}`);
    console.log(chalk.gray('\nReview errors above and fix source CSV before importing.'));
  }
}

// Run
main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(2);
});
