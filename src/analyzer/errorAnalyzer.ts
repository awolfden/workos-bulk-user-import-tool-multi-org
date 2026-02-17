/**
 * Phase 4: Error Analyzer - Main Orchestrator
 *
 * Streams JSONL file line-by-line, classifies errors, groups patterns,
 * and generates reports.
 */

import fs from 'node:fs';
import readline from 'node:readline';
import { createLogger } from '../logger.js';
import { calculateCsvHash } from '../checkpoint/csvUtils.js';
import type { ErrorRecord } from '../types.js';
import type {
  AnalyzerOptions,
  AnalysisReport,
  AnalysisSummary,
  RetryabilitySummary,
  RetryableError
} from './types.js';
import { classifyRetryability } from './retryClassifier.js';
import { groupErrors } from './errorGrouper.js';
import { generateSuggestions } from './errorSuggester.js';

export class ErrorAnalyzer {
  private options: AnalyzerOptions;
  private logger: ReturnType<typeof createLogger>;

  // Tracking
  private allErrors: ErrorRecord[] = [];
  private retryableErrors: RetryableError[] = [];
  private emailsSeen = new Set<string>();
  private errorsByType = new Map<string, number>();
  private errorsByStatus = new Map<string, number>();
  private retryReasons = new Map<string, number>();
  private nonRetryReasons = new Map<string, number>();

  constructor(options: AnalyzerOptions) {
    this.options = options;
    this.logger = createLogger({ quiet: options.quiet });
  }

  /**
   * Main analysis entry point
   */
  async analyze(): Promise<AnalysisReport> {
    this.logger.log('Starting error analysis...');
    this.logger.log(`Errors file: ${this.options.errorsPath}`);

    // Check if file exists
    if (!fs.existsSync(this.options.errorsPath)) {
      throw new Error(`Errors file not found: ${this.options.errorsPath}`);
    }

    // Calculate file hash for report
    const errorsFileHash = await calculateCsvHash(this.options.errorsPath);

    // Stream errors from JSONL
    await this.streamErrors();

    // Group errors by pattern
    this.logger.log(`Grouping ${this.allErrors.length} errors by pattern...`);
    const groups = groupErrors(this.allErrors);

    // Generate suggestions
    this.logger.log('Generating fix suggestions...');
    const suggestions = generateSuggestions(groups);

    // Build report
    const summary = this.generateSummary();
    summary.uniqueErrorPatterns = groups.length;

    const report: AnalysisReport = {
      summary,
      groups,
      retryability: this.generateRetryabilitySummary(),
      suggestions,
      timestamp: new Date().toISOString(),
      errorsFile: this.options.errorsPath,
      errorsFileHash
    };

    // Write report to file
    const reportPath = this.options.reportPath || 'error-analysis-report.json';
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    this.logger.log(`Report written: ${reportPath}`);

    return report;
  }

  /**
   * Stream JSONL file line-by-line
   * Memory: O(1) for streaming, O(n) for group tracking
   */
  private async streamErrors(): Promise<void> {
    return new Promise((resolve, reject) => {
      const fileStream = fs.createReadStream(this.options.errorsPath);
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
      });

      let lineNumber = 0;

      rl.on('line', (line) => {
        lineNumber++;

        // Skip empty lines
        if (!line.trim()) {
          return;
        }

        try {
          const error: ErrorRecord = JSON.parse(line);

          // Track error
          this.allErrors.push(error);

          // Track by type
          const errorType = error.errorType || 'unknown';
          this.errorsByType.set(errorType, (this.errorsByType.get(errorType) || 0) + 1);

          // Track by status
          const status = error.httpStatus?.toString() || 'none';
          this.errorsByStatus.set(status, (this.errorsByStatus.get(status) || 0) + 1);

          // Track email
          if (error.email) {
            this.emailsSeen.add(error.email);
          }

          // Classify retryability
          const classification = classifyRetryability(error);

          if (classification.retryable) {
            // Track retry reason
            this.retryReasons.set(
              classification.reason,
              (this.retryReasons.get(classification.reason) || 0) + 1
            );

            // Extract for retry CSV (if rawRow exists)
            if (error.rawRow && error.email) {
              this.retryableErrors.push({
                email: error.email,
                rawRow: error.rawRow,
                errorRecord: error
              });
            }
          } else {
            // Track non-retry reason
            this.nonRetryReasons.set(
              classification.reason,
              (this.nonRetryReasons.get(classification.reason) || 0) + 1
            );
          }

          // Progress logging (every 1000 errors)
          if (lineNumber % 1000 === 0) {
            this.logger.log(`Processed ${lineNumber} errors...`);
          }
        } catch (err) {
          this.logger.warn(`Line ${lineNumber}: Invalid JSON, skipping: ${err}`);
        }
      });

      rl.on('close', () => {
        this.logger.log(`Loaded ${this.allErrors.length} errors from file`);
        resolve();
      });

      rl.on('error', (err) => {
        reject(new Error(`Failed to read errors file: ${err.message}`));
      });
    });
  }

  /**
   * Generate summary statistics
   */
  private generateSummary(): AnalysisSummary {
    const retryableCount = this.retryableErrors.length;
    const totalCount = this.allErrors.length;

    return {
      totalErrors: totalCount,
      retryableErrors: retryableCount,
      nonRetryableErrors: totalCount - retryableCount,
      uniqueEmails: this.emailsSeen.size,
      uniqueErrorPatterns: 0, // Will be updated by caller with groups.length
      errorsByType: Object.fromEntries(this.errorsByType),
      errorsByStatus: Object.fromEntries(this.errorsByStatus)
    };
  }

  /**
   * Generate retryability summary
   */
  private generateRetryabilitySummary(): RetryabilitySummary {
    const retryableCount = this.retryableErrors.length;
    const totalCount = this.allErrors.length;
    const nonRetryableCount = totalCount - retryableCount;

    return {
      retryable: {
        count: retryableCount,
        percentage: totalCount > 0 ? (retryableCount / totalCount) * 100 : 0,
        byReason: Object.fromEntries(this.retryReasons)
      },
      nonRetryable: {
        count: nonRetryableCount,
        percentage: totalCount > 0 ? (nonRetryableCount / totalCount) * 100 : 0,
        byReason: Object.fromEntries(this.nonRetryReasons)
      }
    };
  }

  /**
   * Get retryable errors for CSV generation
   */
  getRetryableErrors(): RetryableError[] {
    return this.retryableErrors;
  }
}
