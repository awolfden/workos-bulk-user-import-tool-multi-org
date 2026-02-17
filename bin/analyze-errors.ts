#!/usr/bin/env node
/**
 * Phase 4: Error Analyzer - CLI Entry Point
 *
 * Analyze errors.jsonl from failed imports, group by pattern, classify retryability,
 * generate retry CSVs, and suggest fixes.
 *
 * Exit codes:
 * - 0: Success (has retryable errors)
 * - 1: No retryable errors (all errors are non-retryable)
 * - 2: Fatal error (file not found, invalid options)
 */

import 'dotenv/config';
import { Command } from 'commander';
import fs from 'node:fs';
import chalk from 'chalk';
import { ErrorAnalyzer } from '../src/analyzer/errorAnalyzer.js';
import { generateRetryCsv } from '../src/analyzer/retryCsvGenerator.js';
import type { AnalyzerOptions } from '../src/analyzer/types.js';

const program = new Command();

program
  .name('analyze-errors')
  .description('Analyze errors.jsonl from failed imports and generate retry CSVs')
  .version('1.0.0')
  .requiredOption('--errors <path>', 'Path to errors.jsonl file')
  .option('--retry-csv <path>', 'Output path for retry CSV')
  .option('--report <path>', 'JSON report path (default: error-analysis-report.json)', 'error-analysis-report.json')
  .option('--include-duplicates', 'Include duplicate emails in retry CSV (default: false)', false)
  .option('--quiet', 'Suppress progress output')
  .parse(process.argv);

const opts = program.opts();

/**
 * Main analysis function
 */
async function main() {
  // Validate options
  if (!fs.existsSync(opts.errors)) {
    console.error(chalk.red(`Error: Errors file not found: ${opts.errors}`));
    process.exit(2);
  }

  // Build analyzer options
  const options: AnalyzerOptions = {
    errorsPath: opts.errors,
    retryCsvPath: opts.retryCsv,
    reportPath: opts.report,
    includeDuplicates: opts.includeDuplicates,
    quiet: opts.quiet
  };

  try {
    // Run analysis
    const analyzer = new ErrorAnalyzer(options);
    const report = await analyzer.analyze();

    // Generate retry CSV if requested
    if (opts.retryCsv) {
      const retryableErrors = analyzer.getRetryableErrors();

      if (retryableErrors.length === 0) {
        console.log(chalk.yellow('\n⚠️  No retryable errors found - retry CSV not generated'));
      } else {
        await generateRetryCsv(retryableErrors, opts.retryCsv, opts.includeDuplicates);

        if (!opts.quiet) {
          const uniqueCount = opts.includeDuplicates
            ? retryableErrors.length
            : new Set(retryableErrors.map(e => e.email.toLowerCase())).size;
          console.log(chalk.green(`\n✓ Retry CSV generated: ${opts.retryCsv}`));
          console.log(chalk.gray(`  Contains ${uniqueCount} row(s) ${opts.includeDuplicates ? '(including duplicates)' : '(deduplicated by email)'}`));
        }
      }
    }

    // Display summary
    console.log('');
    console.log(chalk.cyan('============================================================'));
    console.log(chalk.cyan('ERROR ANALYSIS SUMMARY'));
    console.log(chalk.cyan('============================================================'));
    console.log(`Total errors:          ${report.summary.totalErrors}`);
    console.log(`Retryable errors:      ${chalk.green(String(report.summary.retryableErrors))} (${report.retryability.retryable.percentage.toFixed(1)}%)`);
    console.log(`Non-retryable errors:  ${chalk.red(String(report.summary.nonRetryableErrors))} (${report.retryability.nonRetryable.percentage.toFixed(1)}%)`);
    console.log(`Unique emails:         ${report.summary.uniqueEmails}`);
    console.log(`Error patterns:        ${report.summary.uniqueErrorPatterns}`);
    console.log(chalk.cyan('============================================================'));
    console.log('');

    // Display top error groups (up to 5)
    if (report.groups.length > 0) {
      console.log(chalk.bold('Top Error Groups:'));
      const topGroups = report.groups
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      for (const group of topGroups) {
        const severityColor =
          group.severity === 'critical' ? chalk.red :
          group.severity === 'high' ? chalk.yellow :
          group.severity === 'medium' ? chalk.blue :
          chalk.gray;

        const retryableTag = group.retryable ? chalk.green('[RETRYABLE]') : chalk.red('[NON-RETRYABLE]');
        console.log(`  ${severityColor(`[${group.severity.toUpperCase()}]`)} ${retryableTag} ${group.pattern} (${group.count} errors)`);
      }
      console.log('');
    }

    // Display retry reasons breakdown
    if (report.summary.retryableErrors > 0) {
      console.log(chalk.bold('Retryable Error Reasons:'));
      const sortedReasons = Object.entries(report.retryability.retryable.byReason)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
      for (const [reason, count] of sortedReasons) {
        console.log(`  ${chalk.green('•')} ${reason}: ${count}`);
      }
      console.log('');
    }

    // Display non-retryable reasons breakdown
    if (report.summary.nonRetryableErrors > 0) {
      console.log(chalk.bold('Non-Retryable Error Reasons:'));
      const sortedReasons = Object.entries(report.retryability.nonRetryable.byReason)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
      for (const [reason, count] of sortedReasons) {
        console.log(`  ${chalk.red('•')} ${reason}: ${count}`);
      }
      console.log('');
    }

    // Display actionable suggestions
    const actionableSuggestions = report.suggestions.filter(s => s.actionable);
    if (actionableSuggestions.length > 0) {
      console.log(chalk.bold('Actionable Fix Suggestions:'));
      for (const suggestion of actionableSuggestions.slice(0, 3)) {
        console.log(chalk.cyan(`\n  ${suggestion.pattern} (${suggestion.affectedCount} errors)`));
        console.log(chalk.gray(`  → ${suggestion.suggestion}`));
        if (suggestion.exampleFix) {
          console.log(chalk.gray(`    Example: ${suggestion.exampleFix}`));
        }
      }
      if (actionableSuggestions.length > 3) {
        console.log(chalk.gray(`\n  ... and ${actionableSuggestions.length - 3} more suggestions in report`));
      }
      console.log('');
    }

    // Display file paths
    console.log(chalk.cyan('============================================================'));
    console.log(`Full report:           ${chalk.cyan(opts.report)}`);
    if (opts.retryCsv && report.summary.retryableErrors > 0) {
      console.log(`Retry CSV:             ${chalk.green(opts.retryCsv)}`);
    }
    console.log(chalk.cyan('============================================================'));
    console.log('');

    // Exit with appropriate code
    if (report.summary.retryableErrors === 0) {
      console.log(chalk.yellow('⚠️  No retryable errors found'));
      console.log(chalk.gray('All errors require manual review and CSV fixes before retrying.'));
      console.log(chalk.gray('Review the fix suggestions above and the full report for details.'));
      process.exit(1);
    } else {
      console.log(chalk.green(`✓ Analysis complete: ${report.summary.retryableErrors} error(s) can be retried`));

      // Detect checkpoint mode by parsing errors path
      const checkpointMatch = opts.errors.match(/\.workos-checkpoints[\/\\]([^\/\\]+)[\/\\]errors\.jsonl/);

      if (checkpointMatch) {
        // Checkpoint mode detected
        const jobId = checkpointMatch[1];
        console.log(chalk.gray(`\nTo retry failed imports from checkpoint, run:`));
        console.log(chalk.cyan(`  npx tsx bin/orchestrate-migration.ts --csv <your-csv> --resume ${jobId}`));
        console.log(chalk.gray('\nNote: Replace <your-csv> with your original CSV path.'));
        console.log(chalk.gray('      Fix any data validation issues in your CSV before retrying.'));
      } else if (opts.retryCsv) {
        // Non-checkpoint mode with retry CSV
        console.log(chalk.gray(`\nTo retry failed imports, run:`));
        console.log(chalk.cyan(`  npx tsx bin/import-users.ts --csv ${opts.retryCsv}`));
      }

      process.exit(0);
    }
  } catch (err) {
    console.error(chalk.red('\n❌ Fatal error during analysis:'));
    console.error(err);

    if (err instanceof Error && err.stack && !opts.quiet) {
      console.error('\nStack trace:');
      console.error(err.stack);
    }

    process.exit(2);
  }
}

main();
