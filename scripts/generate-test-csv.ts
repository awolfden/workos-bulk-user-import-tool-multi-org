#!/usr/bin/env node
/**
 * Generate test CSV files with fake user data for performance testing
 *
 * Usage:
 *   tsx scripts/generate-test-csv.ts 100000 examples/hundred-thousand-users.csv
 *   tsx scripts/generate-test-csv.ts 50000 examples/fifty-thousand-users.csv --with-errors
 */

import fs from 'node:fs';
import path from 'node:path';

interface GenerateOptions {
  count: number;
  outputPath: string;
  withErrors?: boolean;
  errorRate?: number; // 0-1, default 0.05 (5%)
}

function generateEmail(index: number): string {
  const domains = ['example.com', 'test.com', 'demo.org', 'sample.net'];
  const domain = domains[index % domains.length];
  return `user${index}@${domain}`;
}

function generateFirstName(index: number): string {
  const names = [
    'Alice', 'Bob', 'Carol', 'Dave', 'Eve', 'Frank', 'Grace', 'Hank',
    'Ivy', 'Jack', 'Karen', 'Leo', 'Mona', 'Nick', 'Olivia', 'Paul',
    'Quinn', 'Rachel', 'Steve', 'Tina', 'Uma', 'Victor', 'Wendy', 'Xavier',
    'Yara', 'Zack'
  ];
  return names[index % names.length];
}

function generateLastName(index: number): string {
  const names = [
    'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller',
    'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez',
    'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin'
  ];
  return names[index % names.length];
}

function shouldHaveError(index: number, errorRate: number): boolean {
  // Deterministic "errors" based on index
  return (index * 7919) % 1000 < errorRate * 1000;
}

function escapeCsvField(value: string): string {
  // If field contains quotes, commas, or newlines, wrap in quotes and escape internal quotes
  if (!value) return value;
  if (value.includes('"') || value.includes(',') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function generateCSV(options: GenerateOptions): void {
  const { count, outputPath, withErrors = false, errorRate = 0.05 } = options;

  console.log(`Generating ${count.toLocaleString()} users...`);
  const startTime = Date.now();

  // Ensure output directory exists
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const stream = fs.createWriteStream(outputPath, { encoding: 'utf8' });

  // Write header
  stream.write('email,first_name,last_name,email_verified,external_id,metadata\n');

  // Write rows
  for (let i = 0; i < count; i++) {
    const email = generateEmail(i);
    const firstName = generateFirstName(i);
    const lastName = generateLastName(i);
    const emailVerified = i % 3 === 0 ? 'true' : 'false';
    const externalId = `user_${i}`;

    // Add metadata for some users
    let metadata = '';
    if (i % 10 === 0) {
      metadata = JSON.stringify({ role: 'admin', tier: 'premium' });
    } else if (i % 5 === 0) {
      metadata = JSON.stringify({ role: 'user', tier: 'standard' });
    }

    // Introduce intentional errors for testing
    let row: string;
    if (withErrors && shouldHaveError(i, errorRate)) {
      // Intentional error: missing email (invalid row)
      row = `,${firstName},${lastName},${emailVerified},${externalId},${escapeCsvField(metadata)}\n`;
    } else {
      row = `${email},${firstName},${lastName},${emailVerified},${externalId},${escapeCsvField(metadata)}\n`;
    }

    stream.write(row);

    // Progress indicator every 10k rows
    if ((i + 1) % 10000 === 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const rate = Math.round((i + 1) / parseFloat(elapsed));
      console.log(`  ${(i + 1).toLocaleString()} rows written (${rate} rows/sec)`);
    }
  }

  stream.end();

  stream.on('finish', () => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    const fileSize = (fs.statSync(outputPath).size / 1024 / 1024).toFixed(2);
    console.log(`✓ Generated ${count.toLocaleString()} users in ${elapsed}s`);
    console.log(`✓ File size: ${fileSize} MB`);
    console.log(`✓ Output: ${outputPath}`);

    if (withErrors) {
      const errorCount = Math.round(count * errorRate);
      console.log(`✓ Intentional errors: ~${errorCount.toLocaleString()} (${(errorRate * 100).toFixed(1)}%)`);
    }
  });

  stream.on('error', (err) => {
    console.error(`Error writing file: ${err.message}`);
    process.exit(1);
  });
}

// Parse command line arguments
const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Usage: tsx scripts/generate-test-csv.ts <count> <output-path> [--with-errors] [--error-rate <0-1>]');
  console.error('');
  console.error('Examples:');
  console.error('  tsx scripts/generate-test-csv.ts 100000 examples/hundred-thousand-users.csv');
  console.error('  tsx scripts/generate-test-csv.ts 50000 examples/fifty-thousand-users.csv --with-errors');
  console.error('  tsx scripts/generate-test-csv.ts 10000 examples/ten-thousand-with-errors.csv --with-errors --error-rate 0.1');
  process.exit(1);
}

const count = parseInt(args[0], 10);
const outputPath = args[1];
const withErrors = args.includes('--with-errors');
const errorRateIndex = args.indexOf('--error-rate');
const errorRate = errorRateIndex !== -1 ? parseFloat(args[errorRateIndex + 1]) : 0.05;

if (isNaN(count) || count <= 0) {
  console.error('Error: count must be a positive integer');
  process.exit(1);
}

if (withErrors && (isNaN(errorRate) || errorRate < 0 || errorRate > 1)) {
  console.error('Error: error-rate must be between 0 and 1');
  process.exit(1);
}

generateCSV({ count, outputPath, withErrors, errorRate });
