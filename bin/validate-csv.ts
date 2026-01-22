#!/usr/bin/env node
/**
 * Phase 2: CSV Validator - CLI Entry Point
 *
 * Pre-flight validation of CSV files with auto-fix, duplicate detection,
 * and optional API conflict checking.
 *
 * Exit codes:
 * - 0: Valid (no errors)
 * - 1: Invalid (errors found)
 * - 2: Fatal error (bad options, file not found)
 */

import 'dotenv/config';
import { Command } from 'commander';
import fs from 'node:fs';
import chalk from 'chalk';
import { CSVValidator } from '../src/validator/csvValidator.js';
import type { ValidationOptions } from '../src/validator/types.js';

const program = new Command();

program
  .name('validate-csv')
  .description('Validate CSV files before importing to WorkOS')
  .version('2.0.0')
  .requiredOption('--csv <path>', 'CSV file to validate')
  .option('--auto-fix', 'Auto-fix common issues (whitespace, booleans)')
  .option('--fixed-csv <path>', 'Output path for fixed CSV (requires --auto-fix)')
  .option('--dedupe', 'Deduplicate rows with same email address')
  .option('--deduped-csv <path>', 'Output path for deduplicated CSV (requires --dedupe)')
  .option('--dedupe-report <path>', 'Deduplication report path (default: deduplication-report.json)', 'deduplication-report.json')
  .option('--report <path>', 'JSON report path (default: validation-report.json)', 'validation-report.json')
  .option('--check-api', 'Check WorkOS API for conflicts (requires WORKOS_SECRET_KEY)')
  .option('--quiet', 'Suppress progress output')
  .parse(process.argv);

const opts = program.opts();

/**
 * Main validation function
 */
async function main() {
  // Validate options
  if (!fs.existsSync(opts.csv)) {
    console.error(chalk.red(`Error: CSV file not found: ${opts.csv}`));
    process.exit(2);
  }

  if (opts.autoFix && !opts.fixedCsv) {
    console.error(chalk.red('Error: --auto-fix requires --fixed-csv <path>'));
    process.exit(2);
  }

  if (opts.fixedCsv && !opts.autoFix) {
    console.error(chalk.red('Error: --fixed-csv requires --auto-fix'));
    process.exit(2);
  }

  if (opts.checkApi && !process.env.WORKOS_SECRET_KEY) {
    console.error(chalk.red('Error: --check-api requires WORKOS_SECRET_KEY environment variable'));
    process.exit(2);
  }

  if (opts.dedupe && !opts.dedupedCsv) {
    console.error(chalk.red('Error: --dedupe requires --deduped-csv <path>'));
    process.exit(2);
  }

  if (opts.dedupedCsv && !opts.dedupe) {
    console.error(chalk.red('Error: --deduped-csv requires --dedupe'));
    process.exit(2);
  }

  // Build validation options
  const options: ValidationOptions = {
    csvPath: opts.csv,
    autoFix: opts.autoFix,
    fixedCsvPath: opts.fixedCsv,
    dedupe: opts.dedupe,
    dedupedCsvPath: opts.dedupedCsv,
    dedupeReportPath: opts.dedupeReport,
    reportPath: opts.report,
    checkApi: opts.checkApi,
    quiet: opts.quiet
  };

  try {
    // Run validation
    const validator = new CSVValidator(options);
    const report = await validator.validate();

    // Display summary
    console.log('');
    console.log(chalk.cyan('============================================================'));
    console.log(chalk.cyan('CSV VALIDATION SUMMARY'));
    console.log(chalk.cyan('============================================================'));
    console.log(`Total rows:          ${report.summary.totalRows}`);
    console.log(`Valid rows:          ${chalk.green(String(report.summary.validRows))}`);
    console.log(`Invalid rows:        ${report.summary.invalidRows > 0 ? chalk.red(String(report.summary.invalidRows)) : '0'}`);
    console.log(`Warning rows:        ${report.summary.warningRows > 0 ? chalk.yellow(String(report.summary.warningRows)) : '0'}`);
    console.log(`Duplicate emails:    ${report.summary.duplicateEmails > 0 ? chalk.yellow(String(report.summary.duplicateEmails)) : '0'}`);
    console.log(`Duplicate ext IDs:   ${report.summary.duplicateExternalIds > 0 ? chalk.yellow(String(report.summary.duplicateExternalIds)) : '0'}`);
    console.log(`Mode detected:       ${report.summary.mode}`);
    if (report.summary.autoFixApplied) {
      console.log(`Auto-fixed issues:   ${chalk.cyan(String(report.summary.fixedIssues))}`);
    }
    console.log(chalk.cyan('============================================================'));
    console.log('');

    // Count errors and warnings
    const errorCount = report.issues.filter(i => i.severity === 'error').length;
    const warningCount = report.issues.filter(i => i.severity === 'warning' && !i.autoFixed).length;

    if (errorCount > 0) {
      console.log(chalk.red(`❌ Found ${errorCount} error(s)`));
    }
    if (warningCount > 0) {
      console.log(chalk.yellow(`⚠️  Found ${warningCount} warning(s)`));
    }

    // Display deduplication results if enabled
    if (opts.dedupe && opts.dedupeReport && fs.existsSync(opts.dedupeReport)) {
      const dedupeReport = JSON.parse(fs.readFileSync(opts.dedupeReport, 'utf-8'));
      console.log('');
      console.log(chalk.cyan('============================================================'));
      console.log(chalk.cyan('DEDUPLICATION SUMMARY'));
      console.log(chalk.cyan('============================================================'));
      console.log(`Input rows:          ${dedupeReport.summary.totalInputRows}`);
      console.log(`Unique rows:         ${chalk.green(String(dedupeReport.summary.uniqueRows))}`);
      console.log(`Duplicates found:    ${dedupeReport.summary.duplicatesFound > 0 ? chalk.yellow(String(dedupeReport.summary.duplicatesFound)) : '0'}`);
      console.log(`Rows removed:        ${dedupeReport.summary.rowsRemoved > 0 ? chalk.yellow(String(dedupeReport.summary.rowsRemoved)) : '0'}`);
      console.log(chalk.cyan('============================================================'));
      console.log('');
    }

    // Display file paths
    console.log('');
    console.log(`Full report: ${report.summary.autoFixApplied ? chalk.cyan(opts.report) : opts.report}`);
    if (opts.fixedCsv && report.summary.autoFixApplied) {
      console.log(`Fixed CSV:   ${chalk.green(opts.fixedCsv)}`);
    }
    if (opts.dedupedCsv && opts.dedupe) {
      console.log(`Deduped CSV: ${chalk.green(opts.dedupedCsv)}`);
      console.log(`Dedupe report: ${chalk.cyan(opts.dedupeReport)}`);
    }
    console.log('');

    // Exit with appropriate code
    if (errorCount > 0) {
      console.log(chalk.red('Validation failed: CSV has errors'));
      process.exit(1);
    } else if (warningCount > 0) {
      console.log(chalk.yellow('Validation passed with warnings'));
      process.exit(0);
    } else {
      console.log(chalk.green('✓ Validation passed: CSV is valid'));
      process.exit(0);
    }
  } catch (err) {
    console.error(chalk.red('Fatal error during validation:'));
    console.error(err);
    process.exit(2);
  }
}

main();
