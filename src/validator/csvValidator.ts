/**
 * Phase 2: CSV Validator - Main Orchestrator
 *
 * 3-pass streaming validation:
 * - Pass 1: Header validation + mode detection
 * - Pass 2: Row validation + duplicate detection + auto-fix
 * - Pass 3: Optional API conflict checking
 */

import fs from 'node:fs';
import { parse } from 'csv-parse';
import { stringify } from 'csv-stringify';
import { calculateCsvHash } from '../checkpoint/csvUtils.js';
import { isBlank } from '../boolean.js';
import { createLogger } from '../logger.js';
import { DuplicateDetector } from './duplicateDetector.js';
import { HEADER_RULES, ROW_RULES, getAutoFixRules } from './rules.js';
import type {
  ValidationOptions,
  ValidationReport,
  ValidationIssue,
  ValidationSummary,
  ModeDetection
} from './types.js';
import type { CSVRow } from '../types.js';

/**
 * Main CSV validator class
 */
export class CSVValidator {
  private options: ValidationOptions;
  private logger: ReturnType<typeof createLogger>;
  private issues: ValidationIssue[] = [];
  private duplicateDetector = new DuplicateDetector();
  private mode: 'single-org' | 'multi-org' | 'user-only' = 'user-only';
  private totalRows = 0;
  private validRows = 0;
  private invalidRows = 0;
  private warningRows = 0;
  private fixedIssues = 0;

  constructor(options: ValidationOptions) {
    this.options = options;
    this.logger = createLogger({ quiet: options.quiet });
  }

  /**
   * Main validation entry point
   * Executes 3-pass validation and returns report
   */
  async validate(): Promise<ValidationReport> {
    this.logger.log('Starting CSV validation...');
    this.logger.log(`CSV file: ${this.options.csvPath}`);

    // Calculate CSV hash for report
    const csvHash = await calculateCsvHash(this.options.csvPath);

    // Pass 1: Header validation + mode detection
    const headers = await this.validateHeaders();

    // Pass 2: Row validation + duplicate detection + auto-fix
    await this.validateRows(headers);

    // Pass 3: Optional API checking (if enabled)
    if (this.options.checkApi) {
      this.logger.log('API conflict checking not yet implemented');
      // TODO: Implement in Phase 2.3
    }

    // Generate final report
    return this.generateReport(csvHash);
  }

  /**
   * Pass 1: Validate CSV headers and detect mode
   */
  private async validateHeaders(): Promise<string[]> {
    this.logger.log('Pass 1: Validating headers...');

    return new Promise<string[]>((resolve, reject) => {
      const input = fs.createReadStream(this.options.csvPath);

      // First, read just the header line to get column names
      const parser = parse({
        columns: false, // Don't parse as object, just get raw rows
        bom: true,
        skip_empty_lines: true,
        trim: true,
        to_line: 1 // Only read first line
      });

      let headers: string[] = [];

      parser.on('readable', () => {
        const record = parser.read();
        if (record && headers.length === 0) {
          headers = record as string[];
        }
      });

      parser.on('end', () => {
        // Validate headers using header rules
        for (const rule of HEADER_RULES) {
          const ruleIssues = rule.validate({ headers });
          this.issues.push(...ruleIssues);

          // Extract mode from mode-detection rule
          if (rule.id === 'mode-detection' && ruleIssues.length > 0) {
            const modeIssue = ruleIssues[0];
            const modeMatch = modeIssue.message.match(/Detected mode: (\S+)/);
            if (modeMatch) {
              this.mode = modeMatch[1] as 'single-org' | 'multi-org' | 'user-only';
            }
          }
        }

        // Check for fatal header errors
        const headerErrors = this.issues.filter(i => i.severity === 'error' && i.category === 'header');
        if (headerErrors.length > 0) {
          this.logger.error(`Fatal header validation errors found (${headerErrors.length})`);
          for (const error of headerErrors) {
            this.logger.error(`  - ${error.message}`);
          }
        }

        this.logger.log(`Mode detected: ${this.mode}`);
        this.logger.log(`Headers validated: ${headers.length} columns`);
        resolve(headers);
      });

      parser.on('error', (err) => reject(err));

      input.pipe(parser);
    });
  }

  /**
   * Pass 2: Validate rows + duplicate detection + auto-fix
   */
  private async validateRows(headers: string[]): Promise<void> {
    this.logger.log('Pass 2: Validating rows...');

    // Set up fixed CSV output if auto-fix is enabled
    let fixedStream: fs.WriteStream | null = null;
    let stringifier: ReturnType<typeof stringify> | null = null;

    if (this.options.autoFix && this.options.fixedCsvPath) {
      fixedStream = fs.createWriteStream(this.options.fixedCsvPath);
      stringifier = stringify({ header: true, columns: headers });
      stringifier.pipe(fixedStream);
    }

    return new Promise<void>((resolve, reject) => {
      const input = fs.createReadStream(this.options.csvPath);
      const parser = parse({
        columns: true,
        bom: true,
        skip_empty_lines: true,
        trim: true
      });

      let recordNumber = 0;

      parser.on('readable', () => {
        let row: CSVRow | null;
        while ((row = parser.read()) !== null) {
          recordNumber++;
          this.totalRows++;

          // Track progress every 10K rows
          if (recordNumber % 10000 === 0 && !this.options.quiet) {
            this.logger.log(`Processed ${recordNumber} rows...`);
          }

          const rowIssues = this.validateRow(row, recordNumber);
          let hasErrors = rowIssues.some(i => i.severity === 'error');
          let hasWarnings = rowIssues.some(i => i.severity === 'warning');

          // Apply auto-fix if enabled
          if (this.options.autoFix && stringifier) {
            const { fixedRow, changes } = this.applyAutoFixes(row);
            if (changes.length > 0) {
              this.fixedIssues += changes.length;
              // Mark issues as auto-fixed
              for (const issue of rowIssues) {
                const change = changes.find(c => c.field === issue.field);
                if (change) {
                  issue.autoFixed = true;
                  issue.fixedValue = change.fixedValue;
                  // If auto-fixed, downgrade to info
                  if (issue.severity === 'warning') {
                    hasWarnings = false;
                  }
                }
              }
            }
            stringifier.write(fixedRow);
          }

          // Track row status
          if (hasErrors) {
            this.invalidRows++;
          } else if (hasWarnings) {
            this.warningRows++;
          } else {
            this.validRows++;
          }

          this.issues.push(...rowIssues);
        }
      });

      parser.on('end', () => {
        this.logger.log(`Validated ${this.totalRows} rows`);

        // Close fixed CSV stream
        if (stringifier && fixedStream) {
          stringifier.end();
          // Wait for stringifier to finish before closing the file stream
          fixedStream.on('finish', () => {
            this.logger.log(`Fixed CSV written to: ${this.options.fixedCsvPath}`);
            resolve();
          });
        } else {
          resolve();
        }
      });

      parser.on('error', (err) => reject(err));

      input.pipe(parser);
    });
  }

  /**
   * Validate a single row
   */
  private validateRow(row: CSVRow, recordNumber: number): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // Apply all row rules
    for (const rule of ROW_RULES) {
      const ruleIssues = rule.validate({ row, recordNumber, mode: this.mode });
      issues.push(...ruleIssues);
    }

    // Check for duplicate email
    const email = typeof row.email === 'string' ? row.email.trim() : '';
    if (email) {
      if (this.duplicateDetector.hasEmail(email)) {
        issues.push({
          severity: 'warning',
          category: 'duplicate',
          recordNumber,
          field: 'email',
          email,
          message: `Duplicate email: ${email}`,
          ruleId: 'duplicate-email'
        });
      } else {
        this.duplicateDetector.addEmail(email);
      }
    }

    // Check for duplicate external_id
    const externalId = typeof row.external_id === 'string' ? row.external_id.trim() : '';
    if (externalId && !isBlank(externalId)) {
      if (this.duplicateDetector.hasExternalId(externalId)) {
        issues.push({
          severity: 'warning',
          category: 'duplicate',
          recordNumber,
          field: 'external_id',
          email,
          message: `Duplicate external_id: ${externalId}`,
          ruleId: 'duplicate-external-id'
        });
      } else {
        this.duplicateDetector.addExternalId(externalId);
      }
    }

    return issues;
  }

  /**
   * Apply auto-fixes to a row
   */
  private applyAutoFixes(row: CSVRow): { fixedRow: CSVRow; changes: any[] } {
    let fixedRow = { ...row };
    const allChanges: any[] = [];

    const autoFixRules = getAutoFixRules();
    for (const rule of autoFixRules) {
      if (rule.autofix) {
        const { fixed, changes } = rule.autofix(fixedRow);
        fixedRow = fixed;
        allChanges.push(...changes);
      }
    }

    return { fixedRow, changes: allChanges };
  }

  /**
   * Generate final validation report
   */
  private generateReport(csvHash: string): ValidationReport {
    const stats = this.duplicateDetector.getStats();

    const summary: ValidationSummary = {
      totalRows: this.totalRows,
      validRows: this.validRows,
      invalidRows: this.invalidRows,
      warningRows: this.warningRows,
      duplicateEmails: stats.emails,
      duplicateExternalIds: stats.externalIds,
      mode: this.mode,
      autoFixApplied: this.options.autoFix || false,
      fixedIssues: this.fixedIssues
    };

    const report: ValidationReport = {
      summary,
      issues: this.issues,
      timestamp: new Date().toISOString(),
      csvHash
    };

    // Write report to file if specified
    if (this.options.reportPath) {
      fs.writeFileSync(this.options.reportPath, JSON.stringify(report, null, 2));
      this.logger.log(`Report written to: ${this.options.reportPath}`);
    }

    return report;
  }
}
