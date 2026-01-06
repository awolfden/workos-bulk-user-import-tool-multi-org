/**
 * Phase 4: Retry CSV Generator
 *
 * Extracts rawRow from retryable errors, deduplicates by email,
 * and writes to CSV in WorkOS format.
 */

import fs from 'node:fs';
import { stringify } from 'csv-stringify';
import type { RetryableError } from './types.js';

/**
 * Generate retry CSV from retryable errors
 *
 * Deduplicates by email (keeps first occurrence unless includeDuplicates=true)
 */
export async function generateRetryCsv(
  retryableErrors: RetryableError[],
  outputPath: string,
  includeDuplicates: boolean
): Promise<void> {
  let rows: Record<string, unknown>[] = [];

  if (includeDuplicates) {
    // Include all errors (no deduplication)
    rows = retryableErrors.map(error => error.rawRow);
  } else {
    // Deduplicate by email (keep first occurrence)
    const uniqueErrors = new Map<string, RetryableError>();

    for (const error of retryableErrors) {
      const email = error.email.toLowerCase();

      if (!uniqueErrors.has(email)) {
        uniqueErrors.set(email, error);
      }
    }

    // Extract rows
    rows = Array.from(uniqueErrors.values()).map(error => error.rawRow);
  }

  if (rows.length === 0) {
    throw new Error('No retryable errors with rawRow data found');
  }

  // Determine column order (preserve original order from first row)
  const firstRow = rows[0];
  const columns = Object.keys(firstRow);

  // Ensure standard WorkOS columns come first
  const standardColumns = [
    'email',
    'password',
    'password_hash',
    'password_hash_type',
    'first_name',
    'last_name',
    'email_verified',
    'external_id',
    'metadata',
    'org_id',
    'org_external_id',
    'org_name'
  ];

  const orderedColumns = [
    ...standardColumns.filter(col => columns.includes(col)),
    ...columns.filter(col => !standardColumns.includes(col))
  ];

  // Write CSV
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const stringifier = stringify({
      header: true,
      columns: orderedColumns,
      cast: {
        boolean: (value) => (value ? 'true' : 'false')
      }
    });

    stringifier.pipe(output);

    for (const row of rows) {
      stringifier.write(row);
    }

    stringifier.end();

    output.on('finish', () => resolve());
    output.on('error', (err) => reject(err));
  });
}
