/**
 * Phase 3: CSV analysis and hashing utilities
 */

import fs from 'node:fs';
import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import readline from 'node:readline';

/**
 * Calculate SHA-256 hash of CSV file for change detection
 * Fast: Streams file without loading into memory
 */
export async function calculateCsvHash(csvPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = createReadStream(csvPath);

    stream.on('data', (chunk) => {
      hash.update(chunk);
    });

    stream.on('end', () => {
      resolve(hash.digest('hex'));
    });

    stream.on('error', (err) => {
      reject(new Error(`Failed to calculate CSV hash: ${err.message}`));
    });
  });
}

/**
 * Count rows in CSV file for progress tracking
 * Fast: ~1s for 1M rows (streaming, counts newlines)
 * Returns count of data rows (excludes header)
 */
export async function countCsvRows(csvPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    let lineCount = 0;
    const rl = readline.createInterface({
      input: createReadStream(csvPath),
      crlfDelay: Infinity
    });

    rl.on('line', () => {
      lineCount++;
    });

    rl.on('close', () => {
      // Subtract 1 for header row
      resolve(Math.max(0, lineCount - 1));
    });

    rl.on('error', (err) => {
      reject(new Error(`Failed to count CSV rows: ${err.message}`));
    });
  });
}

/**
 * Validate CSV headers and detect multi-org mode
 * Fast: Only reads first line
 */
export async function validateCsvHeaders(csvPath: string): Promise<{
  valid: boolean;
  error?: string;
  hasOrgColumns: boolean;
}> {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({
      input: createReadStream(csvPath),
      crlfDelay: Infinity
    });

    let headerLine: string | null = null;

    rl.on('line', (line) => {
      if (headerLine === null) {
        headerLine = line;
        rl.close(); // Only need first line
      }
    });

    rl.on('close', () => {
      if (!headerLine) {
        resolve({
          valid: false,
          error: 'CSV file is empty',
          hasOrgColumns: false
        });
        return;
      }

      // Parse headers (simple split, assumes no quoted commas in header)
      const headers = headerLine.split(',').map(h => h.trim().toLowerCase());

      // Check for required 'email' column
      if (!headers.includes('email')) {
        resolve({
          valid: false,
          error: 'CSV must have an "email" column',
          hasOrgColumns: false
        });
        return;
      }

      // Check for org columns (multi-org mode detection)
      const hasOrgColumns = headers.includes('org_id') || headers.includes('org_external_id');

      resolve({
        valid: true,
        hasOrgColumns
      });
    });

    rl.on('error', (err) => {
      reject(new Error(`Failed to validate CSV headers: ${err.message}`));
    });
  });
}
