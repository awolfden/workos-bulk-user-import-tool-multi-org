/**
 * Email Deduplication Utility
 *
 * Handles merging duplicate email addresses from Auth0/other IdPs where
 * the same email can exist multiple times (different auth methods).
 *
 * WorkOS requires unique emails, so this utility:
 * - Groups rows by normalized email
 * - Merges metadata from all duplicates
 * - Picks canonical values for other fields
 * - Generates a report of what was merged
 */

import type { CSVRow } from '../types.js';
import { isBlank, parseBooleanLike } from '../boolean.js';

/**
 * Deduplication result
 */
export interface DeduplicationResult {
  /** Deduplicated rows */
  deduplicatedRows: CSVRow[];
  /** Total duplicates found */
  duplicatesFound: number;
  /** Total rows removed */
  rowsRemoved: number;
  /** Merge details for reporting */
  mergeDetails: MergeDetail[];
}

/**
 * Details about a single merge operation
 */
export interface MergeDetail {
  /** Email that was deduplicated */
  email: string;
  /** Number of duplicate rows merged */
  duplicateCount: number;
  /** Row numbers that were merged (1-indexed) */
  mergedRowNumbers: number[];
  /** Fields that had conflicts */
  conflicts: FieldConflict[];
  /** Metadata keys that were merged */
  metadataMerged: string[];
}

/**
 * Field conflict details
 */
export interface FieldConflict {
  /** Field name */
  field: string;
  /** Values from all duplicates */
  values: string[];
  /** Value chosen for the merged record */
  chosen: string;
  /** Strategy used to resolve */
  strategy: 'first-non-empty' | 'true-if-any' | 'merge-metadata' | 'first-occurrence';
}

/**
 * Email deduplicator class
 */
export class EmailDeduplicator {
  /**
   * Deduplicate rows by email address
   *
   * @param rows - CSV rows to deduplicate
   * @param startingRowNumber - Starting row number for reporting (default: 2)
   * @returns Deduplication result
   */
  deduplicate(rows: CSVRow[], startingRowNumber: number = 2): DeduplicationResult {
    // Group rows by normalized email
    const emailGroups = this.groupByEmail(rows, startingRowNumber);

    const deduplicatedRows: CSVRow[] = [];
    const mergeDetails: MergeDetail[] = [];
    let duplicatesFound = 0;
    let rowsRemoved = 0;

    // Process each email group
    for (const [email, group] of emailGroups.entries()) {
      if (group.rows.length === 1) {
        // No duplicates, keep as-is
        deduplicatedRows.push(group.rows[0]);
      } else {
        // Duplicates found - merge them
        duplicatesFound++;
        rowsRemoved += group.rows.length - 1;

        const { mergedRow, conflicts, metadataMerged } = this.mergeRows(group.rows);
        deduplicatedRows.push(mergedRow);

        mergeDetails.push({
          email,
          duplicateCount: group.rows.length,
          mergedRowNumbers: group.rowNumbers,
          conflicts,
          metadataMerged
        });
      }
    }

    return {
      deduplicatedRows,
      duplicatesFound,
      rowsRemoved,
      mergeDetails
    };
  }

  /**
   * Group rows by normalized email
   */
  private groupByEmail(
    rows: CSVRow[],
    startingRowNumber: number
  ): Map<string, { rows: CSVRow[]; rowNumbers: number[] }> {
    const groups = new Map<string, { rows: CSVRow[]; rowNumbers: number[] }>();

    rows.forEach((row, index) => {
      const email = this.normalizeEmail(String(row.email || ''));
      if (!email) return; // Skip rows without email

      if (!groups.has(email)) {
        groups.set(email, { rows: [], rowNumbers: [] });
      }

      const group = groups.get(email)!;
      group.rows.push(row);
      group.rowNumbers.push(startingRowNumber + index);
    });

    return groups;
  }

  /**
   * Merge multiple rows with the same email
   */
  private mergeRows(rows: CSVRow[]): {
    mergedRow: CSVRow;
    conflicts: FieldConflict[];
    metadataMerged: string[];
  } {
    const conflicts: FieldConflict[] = [];
    const metadataMerged: string[] = [];

    // Start with the first row as base
    const mergedRow: CSVRow = { ...rows[0] };

    // Merge email_verified: true if ANY row has it as true
    const emailVerifiedValues = rows
      .map(r => parseBooleanLike(r.email_verified))
      .filter(v => v !== undefined);

    if (emailVerifiedValues.some(v => v === true)) {
      mergedRow.email_verified = true;

      const uniqueValues = [...new Set(emailVerifiedValues.map(String))];
      if (uniqueValues.length > 1) {
        conflicts.push({
          field: 'email_verified',
          values: uniqueValues,
          chosen: 'true',
          strategy: 'true-if-any'
        });
      }
    }

    // Merge standard fields using first-non-empty strategy
    const standardFields = ['first_name', 'last_name', 'external_id', 'password_hash', 'password_hash_type'];

    for (const field of standardFields) {
      const values = rows
        .map(r => String(r[field] || '').trim())
        .filter(v => !isBlank(v));

      const uniqueValues = [...new Set(values)];

      if (uniqueValues.length > 1) {
        conflicts.push({
          field,
          values: uniqueValues,
          chosen: uniqueValues[0],
          strategy: 'first-non-empty'
        });
      }

      if (uniqueValues.length > 0 && !mergedRow[field]) {
        mergedRow[field] = uniqueValues[0];
      }
    }

    // Merge organization fields
    const orgFields = ['org_id', 'org_external_id', 'org_name'];

    for (const field of orgFields) {
      const values = rows
        .map(r => String(r[field] || '').trim())
        .filter(v => !isBlank(v));

      const uniqueValues = [...new Set(values)];

      if (uniqueValues.length > 1) {
        conflicts.push({
          field,
          values: uniqueValues,
          chosen: uniqueValues[0],
          strategy: 'first-non-empty'
        });
      }

      if (uniqueValues.length > 0 && !mergedRow[field]) {
        mergedRow[field] = uniqueValues[0];
      }
    }

    // Merge metadata: combine all unique key-value pairs
    const mergedMetadata: Record<string, any> = {};
    const metadataConflicts: Map<string, string[]> = new Map();

    for (const row of rows) {
      if (row.metadata) {
        const metadata = this.parseMetadata(row.metadata);

        if (Object.keys(metadata).length > 0) {
          for (const [key, value] of Object.entries(metadata)) {
            if (!mergedMetadata[key]) {
              mergedMetadata[key] = value;
              metadataMerged.push(key);
            } else if (JSON.stringify(mergedMetadata[key]) !== JSON.stringify(value)) {
              // Conflict detected - track it
              if (!metadataConflicts.has(key)) {
                metadataConflicts.set(key, [JSON.stringify(mergedMetadata[key])]);
              }
              metadataConflicts.get(key)!.push(JSON.stringify(value));
            }
          }
        }
      }
    }

    // Report metadata conflicts
    for (const [key, values] of metadataConflicts.entries()) {
      const uniqueValues = [...new Set(values)];
      if (uniqueValues.length > 1) {
        conflicts.push({
          field: `metadata.${key}`,
          values: uniqueValues,
          chosen: uniqueValues[0],
          strategy: 'first-occurrence'
        });
      }
    }

    // Set merged metadata if any
    if (Object.keys(mergedMetadata).length > 0) {
      // Store as JSON string if original was string, otherwise as object
      if (typeof rows[0].metadata === 'string') {
        mergedRow.metadata = JSON.stringify(mergedMetadata);
      } else {
        mergedRow.metadata = mergedMetadata;
      }
    }

    // Remove duplicate metadata keys
    metadataMerged.splice(0, metadataMerged.length, ...[...new Set(metadataMerged)]);

    return { mergedRow, conflicts, metadataMerged };
  }

  /**
   * Parse metadata from string or object
   */
  private parseMetadata(metadata: any): Record<string, any> {
    if (typeof metadata === 'object' && metadata !== null) {
      return metadata;
    }

    if (typeof metadata === 'string') {
      try {
        return JSON.parse(metadata);
      } catch {
        return {};
      }
    }

    return {};
  }

  /**
   * Normalize email for consistent grouping
   */
  private normalizeEmail(email: string): string {
    return email.toLowerCase().trim();
  }
}
