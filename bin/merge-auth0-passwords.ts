#!/usr/bin/env node
/**
 * Merge Auth0 Password Hashes into CSV Export
 *
 * Auth0 does not provide password hashes via the Management API.
 * You must request a password export from Auth0 support, which provides
 * an NDJSON file containing user emails and bcrypt password hashes.
 *
 * This tool merges that password data into your Auth0 CSV export.
 *
 * Usage:
 *   npx tsx bin/merge-auth0-passwords.ts \
 *     --csv auth0-export.csv \
 *     --passwords auth0-passwords.ndjson \
 *     --output auth0-export-with-passwords.csv
 */

import { Command } from 'commander';
import { createReadStream, createWriteStream, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { parse } from 'csv-parse';
import { stringify } from 'csv-stringify';

interface Auth0PasswordRecord {
  _id?: { $oid: string };
  email: string;
  email_verified?: boolean;
  passwordHash: string;
  password_set_date?: { $date: string };
  tenant?: string;
  connection?: string;
}

interface PasswordLookup {
  [email: string]: {
    hash: string;
    algorithm: string;
    setDate?: string;
  };
}

const program = new Command();

program
  .name('merge-auth0-passwords')
  .description('Merge Auth0 password hashes from NDJSON export into CSV')
  .requiredOption('--csv <path>', 'Path to Auth0 CSV export file')
  .requiredOption('--passwords <path>', 'Path to Auth0 password NDJSON export file')
  .requiredOption('--output <path>', 'Path to output CSV file with passwords')
  .option('--quiet', 'Suppress output messages')
  .parse(process.argv);

const opts = program.opts();

async function main() {
  const startTime = Date.now();

  if (!opts.quiet) {
    console.log('Auth0 Password Merge Tool');
    console.log('=========================\n');
  }

  // Step 1: Parse NDJSON password file
  if (!opts.quiet) {
    console.log('Step 1: Loading password hashes from NDJSON...');
  }

  const passwordLookup = await loadPasswordHashes(opts.passwords);
  const passwordCount = Object.keys(passwordLookup).length;

  if (!opts.quiet) {
    console.log(`✓ Loaded ${passwordCount} password hashes\n`);
  }

  // Step 2: Merge passwords into CSV
  if (!opts.quiet) {
    console.log('Step 2: Merging passwords into CSV...');
  }

  const stats = await mergeCsvWithPasswords(
    opts.csv,
    opts.output,
    passwordLookup,
    !opts.quiet
  );

  if (!opts.quiet) {
    console.log(`✓ Processed ${stats.totalRows} rows`);
    console.log(`✓ Added passwords for ${stats.passwordsAdded} users`);
    console.log(`✓ No password found for ${stats.passwordsNotFound} users`);

    const duration = Date.now() - startTime;
    console.log(`\n✓ Complete in ${duration}ms`);
    console.log(`Output: ${opts.output}`);
  }

  process.exit(0);
}

/**
 * Load password hashes from Auth0 NDJSON export
 */
async function loadPasswordHashes(filePath: string): Promise<PasswordLookup> {
  const lookup: PasswordLookup = {};

  const fileStream = createReadStream(filePath, { encoding: 'utf-8' });
  const rl = createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    if (!line.trim()) continue;

    try {
      const record: Auth0PasswordRecord = JSON.parse(line);

      if (!record.email || !record.passwordHash) {
        continue;
      }

      // Normalize email to lowercase for matching
      const email = record.email.toLowerCase();

      // Detect hash algorithm from hash format
      const algorithm = detectHashAlgorithm(record.passwordHash);

      lookup[email] = {
        hash: record.passwordHash,
        algorithm,
        setDate: record.password_set_date?.$date
      };
    } catch (error) {
      // Skip invalid JSON lines
      console.warn(`Warning: Skipped invalid JSON line: ${line.substring(0, 50)}...`);
    }
  }

  return lookup;
}

/**
 * Detect password hash algorithm from hash format
 */
function detectHashAlgorithm(hash: string): string {
  // Bcrypt: $2a$, $2b$, $2x$, $2y$
  if (/^\$2[abxy]\$/.test(hash)) {
    return 'bcrypt';
  }

  // MD5: 32 hex characters
  if (/^[a-f0-9]{32}$/i.test(hash)) {
    return 'md5';
  }

  // SHA256: 64 hex characters
  if (/^[a-f0-9]{64}$/i.test(hash)) {
    return 'sha256';
  }

  // SHA512: 128 hex characters
  if (/^[a-f0-9]{128}$/i.test(hash)) {
    return 'sha512';
  }

  // PBKDF2: Often has format like sha1:iterations:salt:hash
  if (hash.includes(':')) {
    return 'pbkdf2';
  }

  // Default to bcrypt if unknown (Auth0 primarily uses bcrypt)
  return 'bcrypt';
}

/**
 * Merge password hashes into CSV export
 */
async function mergeCsvWithPasswords(
  inputCsv: string,
  outputCsv: string,
  passwordLookup: PasswordLookup,
  verbose: boolean
): Promise<{
  totalRows: number;
  passwordsAdded: number;
  passwordsNotFound: number;
}> {
  return new Promise((resolve, reject) => {
    let totalRows = 0;
    let passwordsAdded = 0;
    let passwordsNotFound = 0;

    const inputStream = createReadStream(inputCsv);
    const outputStream = createWriteStream(outputCsv);

    const parser = parse({
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true
    });

    const stringifier = stringify({
      header: true,
      columns: [
        'email',
        'first_name',
        'last_name',
        'email_verified',
        'password_hash',
        'password_hash_type',
        'external_id',
        'org_external_id',
        'org_name',
        'metadata'
      ]
    });

    inputStream
      .pipe(parser)
      .on('data', (row: any) => {
        totalRows++;

        const email = row.email?.toLowerCase();

        // Look up password hash for this user
        if (email && passwordLookup[email]) {
          const passwordData = passwordLookup[email];
          row.password_hash = passwordData.hash;
          row.password_hash_type = passwordData.algorithm;
          passwordsAdded++;

          if (verbose && passwordsAdded % 100 === 0) {
            process.stdout.write(`  Processed ${totalRows} rows (${passwordsAdded} with passwords)...\r`);
          }
        } else {
          // No password found - leave fields empty
          row.password_hash = '';
          row.password_hash_type = '';
          passwordsNotFound++;
        }

        stringifier.write(row);
      })
      .on('end', () => {
        stringifier.end();
        if (verbose) {
          process.stdout.write('\n');
        }
      })
      .on('error', (error) => {
        reject(error);
      });

    stringifier
      .pipe(outputStream)
      .on('finish', () => {
        resolve({ totalRows, passwordsAdded, passwordsNotFound });
      })
      .on('error', (error) => {
        reject(error);
      });
  });
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
