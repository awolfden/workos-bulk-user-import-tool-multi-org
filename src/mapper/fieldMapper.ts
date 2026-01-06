/**
 * Phase 3: Field Mapper - Core Streaming Transformer
 *
 * Transforms CSV files from provider format to WorkOS format using streaming architecture.
 * Memory usage: O(1) regardless of CSV size.
 */

import fs from 'node:fs';
import { parse } from 'csv-parse';
import { stringify } from 'csv-stringify';
import { createLogger } from '../logger.js';
import { isBlank } from '../boolean.js';
import { getTransformer } from './transformers.js';
import type { CSVRow } from '../types.js';
import type {
  MapperOptions,
  MappingSummary,
  MappingError,
  FieldMapping,
  MetadataMapping
} from './types.js';

/**
 * Field Mapper
 *
 * Streams CSV transformation from provider format to WorkOS format.
 */
export class FieldMapper {
  private options: MapperOptions;
  private logger: ReturnType<typeof createLogger>;
  private startTime: number = 0;
  private endTime: number = 0;

  // Tracking
  private totalRows = 0;
  private successfulRows = 0;
  private errorRows = 0;
  private errors: MappingError[] = [];
  private skippedFields: Record<string, number> = {};

  constructor(options: MapperOptions) {
    this.options = options;
    this.logger = createLogger({ quiet: options.quiet });
  }

  /**
   * Transform CSV file
   *
   * Main entry point for field mapping.
   */
  async transform(): Promise<MappingSummary> {
    this.logger.log('Starting CSV field mapping...');
    this.logger.log(`Profile: ${this.options.profile.name}`);
    this.logger.log(`Input: ${this.options.inputPath}`);
    this.logger.log(`Output: ${this.options.outputPath}`);

    this.startTime = Date.now();

    try {
      // Stream transformation
      await this.streamTransform();

      this.endTime = Date.now();

      // Optionally validate output
      if (this.options.validateAfter) {
        await this.validateOutput();
      }

      // Generate summary
      return this.generateSummary();
    } catch (error) {
      this.endTime = Date.now();
      throw error;
    }
  }

  /**
   * Stream CSV transformation
   *
   * Reads input CSV, transforms rows, writes output CSV.
   * Uses streaming to handle large files with constant memory.
   */
  private async streamTransform(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Input stream
      const inputStream = fs.createReadStream(this.options.inputPath);
      const parser = parse({
        columns: true,          // Parse as objects
        bom: true,              // Handle BOM
        skip_empty_lines: true,
        trim: true
      });

      // Output stream
      const outputStream = fs.createWriteStream(this.options.outputPath);
      const stringifier = stringify({
        header: true,
        columns: this.getOutputColumns()
      });

      // Pipe output
      stringifier.pipe(outputStream);

      // Track progress
      let recordNumber = 0;

      // Process rows
      parser.on('readable', () => {
        let sourceRow: Record<string, unknown>;
        while ((sourceRow = parser.read()) !== null) {
          recordNumber++;
          this.totalRows++;

          try {
            // Transform row
            const targetRow = this.transformRow(sourceRow, recordNumber);

            // Write to output
            stringifier.write(targetRow);

            this.successfulRows++;

            // Progress logging (every 10K rows)
            if (this.totalRows % 10000 === 0) {
              this.logger.log(`Processed ${this.totalRows} rows...`);
            }
          } catch (error) {
            // Log error but continue processing
            this.errorRows++;
            this.errors.push({
              recordNumber,
              sourceRow,
              errorMessage: error instanceof Error ? error.message : String(error)
            });

            // Stop if too many errors
            if (this.errors.length > 1000) {
              parser.destroy();
              reject(new Error('Too many errors (>1000) - stopping transformation'));
              return;
            }
          }
        }
      });

      // Handle parser end
      parser.on('end', () => {
        stringifier.end();
      });

      // Handle output stream finish
      outputStream.on('finish', () => {
        this.logger.log(`\nMapping complete: ${this.successfulRows}/${this.totalRows} rows`);
        resolve();
      });

      // Handle errors
      inputStream.on('error', reject);
      parser.on('error', reject);
      stringifier.on('error', reject);
      outputStream.on('error', reject);

      // Start streaming
      inputStream.pipe(parser);
    });
  }

  /**
   * Transform a single row
   *
   * Applies profile mappings and transformers to convert source row to target row.
   */
  private transformRow(sourceRow: Record<string, unknown>, recordNumber: number): CSVRow {
    const targetRow: CSVRow = {};

    // Apply field mappings
    for (const mapping of this.options.profile.mappings) {
      const value = this.applyMapping(mapping, sourceRow);
      if (value !== undefined) {
        (targetRow as Record<string, unknown>)[mapping.targetField] = value;
      }
    }

    // Apply metadata mapping if present
    if (this.options.profile.metadataMapping) {
      const metadata = this.applyMetadataMapping(this.options.profile.metadataMapping, sourceRow);
      if (metadata !== undefined) {
        targetRow.metadata = metadata;
      }
    }

    // Track unmapped source fields
    this.trackUnmappedFields(sourceRow, targetRow);

    return targetRow;
  }

  /**
   * Apply a single field mapping
   */
  private applyMapping(mapping: FieldMapping, sourceRow: Record<string, unknown>): string | boolean | undefined {
    const sourceValue = sourceRow[mapping.sourceField];

    // Handle blank values
    if (sourceValue === undefined || sourceValue === null || (typeof sourceValue === 'string' && isBlank(sourceValue))) {
      // Skip if configured
      if (mapping.skipIfBlank) {
        return undefined;
      }

      // Use default value if provided
      if (mapping.defaultValue !== undefined) {
        return mapping.defaultValue;
      }

      return undefined;
    }

    // Apply transformer if specified
    if (mapping.transformer) {
      try {
        const transformer = getTransformer(mapping.transformer);
        return transformer(sourceValue, sourceRow);
      } catch (error) {
        throw new Error(`Transformer '${mapping.transformer}' failed for field '${mapping.sourceField}': ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // No transformer - pass through as string
    return String(sourceValue);
  }

  /**
   * Apply metadata mapping (many-to-one)
   *
   * Merges multiple source fields into a single metadata JSON field.
   */
  private applyMetadataMapping(mapping: MetadataMapping, sourceRow: Record<string, unknown>): string | undefined {
    const mergedMetadata: Record<string, unknown> = {};

    // Start with static metadata
    if (mapping.staticMetadata) {
      Object.assign(mergedMetadata, mapping.staticMetadata);
    }

    // Merge source fields
    for (const sourceField of mapping.sourceFields) {
      const sourceValue = sourceRow[sourceField];

      if (sourceValue === undefined || sourceValue === null) {
        continue;
      }

      // Parse JSON if it's a string
      if (typeof sourceValue === 'string') {
        if (isBlank(sourceValue)) {
          continue;
        }

        try {
          const parsed = JSON.parse(sourceValue);
          if (typeof parsed === 'object' && parsed !== null) {
            // Apply prefix if specified
            if (mapping.fieldPrefix) {
              for (const [key, value] of Object.entries(parsed)) {
                mergedMetadata[mapping.fieldPrefix + key] = value;
              }
            } else {
              Object.assign(mergedMetadata, parsed);
            }
          }
        } catch {
          // Not valid JSON - store as string with prefix
          const key = mapping.fieldPrefix ? mapping.fieldPrefix + sourceField : sourceField;
          mergedMetadata[key] = sourceValue;
        }
      } else if (typeof sourceValue === 'object' && sourceValue !== null) {
        // Already an object - merge directly
        if (mapping.fieldPrefix) {
          for (const [key, value] of Object.entries(sourceValue)) {
            mergedMetadata[mapping.fieldPrefix + key] = value;
          }
        } else {
          Object.assign(mergedMetadata, sourceValue);
        }
      } else {
        // Primitive value - store with field name as key
        const key = mapping.fieldPrefix ? mapping.fieldPrefix + sourceField : sourceField;
        mergedMetadata[key] = sourceValue;
      }
    }

    // Return JSON string if not empty
    if (Object.keys(mergedMetadata).length === 0) {
      return undefined;
    }

    return JSON.stringify(mergedMetadata);
  }

  /**
   * Track unmapped source fields
   *
   * Records fields from source CSV that were not mapped to target CSV.
   */
  private trackUnmappedFields(sourceRow: Record<string, unknown>, targetRow: CSVRow): void {
    const mappedSourceFields = new Set<string>();

    // Collect all mapped source fields
    for (const mapping of this.options.profile.mappings) {
      mappedSourceFields.add(mapping.sourceField);
    }
    if (this.options.profile.metadataMapping) {
      for (const field of this.options.profile.metadataMapping.sourceFields) {
        mappedSourceFields.add(field);
      }
    }

    // Track unmapped fields
    for (const sourceField of Object.keys(sourceRow)) {
      if (!mappedSourceFields.has(sourceField)) {
        this.skippedFields[sourceField] = (this.skippedFields[sourceField] || 0) + 1;
      }
    }
  }

  /**
   * Get output columns in WorkOS standard order
   *
   * Returns only columns that are actually mapped.
   */
  private getOutputColumns(): string[] {
    const workosColumns = [
      'email',
      'first_name',
      'last_name',
      'email_verified',
      'password',
      'password_hash',
      'password_hash_type',
      'external_id',
      'metadata',
      'org_id',
      'org_external_id',
      'org_name'
    ];

    // Collect target fields from mappings
    const mappedFields = new Set<string>();
    for (const mapping of this.options.profile.mappings) {
      mappedFields.add(mapping.targetField);
    }
    if (this.options.profile.metadataMapping) {
      mappedFields.add('metadata');
    }

    // Return only mapped columns in WorkOS order
    return workosColumns.filter(col => mappedFields.has(col));
  }

  /**
   * Validate output CSV using Phase 2 validator
   */
  private async validateOutput(): Promise<void> {
    this.logger.log('\nValidating output CSV...');

    try {
      // Dynamic import to avoid circular dependency
      const { CSVValidator } = await import('../validator/csvValidator.js');

      const validator = new CSVValidator({
        csvPath: this.options.outputPath,
        reportPath: this.options.outputPath.replace('.csv', '-validation-report.json'),
        quiet: this.options.quiet
      });

      const report = await validator.validate();

      const errorCount = report.issues.filter(i => i.severity === 'error').length;
      if (errorCount > 0) {
        this.logger.log(`\n⚠️  Validation found ${errorCount} error(s) in output CSV`);
        this.logger.log(`See report: ${this.options.outputPath.replace('.csv', '-validation-report.json')}`);
      } else {
        this.logger.log('✓ Output CSV is valid');
      }
    } catch (error) {
      this.logger.log(`Warning: Failed to validate output: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Generate mapping summary
   */
  private generateSummary(): MappingSummary {
    return {
      totalRows: this.totalRows,
      successfulRows: this.successfulRows,
      errorRows: this.errorRows,
      skippedFields: this.skippedFields,
      startedAt: this.startTime,
      endedAt: this.endTime,
      durationMs: this.endTime - this.startTime,
      errors: this.errors
    };
  }
}
