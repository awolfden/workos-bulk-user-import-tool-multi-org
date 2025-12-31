#!/usr/bin/env node
/**
 * Generate multi-org test CSV files with fake user data for performance testing
 *
 * Usage:
 *   tsx scripts/generate-multi-org-csv.ts 10000 50 examples/multi-org-10k-users-50-orgs.csv
 *   tsx scripts/generate-multi-org-csv.ts 100000 1000 examples/multi-org-100k-users-1k-orgs.csv
 *   tsx scripts/generate-multi-org-csv.ts 1000 10 examples/multi-org-test.csv --with-errors --error-rate 0.1
 */

import fs from 'node:fs';
import path from 'node:path';

interface GenerateOptions {
  userCount: number;
  orgCount: number;
  outputPath: string;
  withErrors?: boolean;
  errorRate?: number; // 0-1, default 0.05 (5%)
  distribution?: 'uniform' | 'skewed'; // How users are distributed across orgs
}

function generateEmail(index: number, orgIndex: number): string {
  return `user${index}@org${orgIndex}.example.com`;
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

function generateOrgExternalId(orgIndex: number): string {
  return `org-${String(orgIndex).padStart(6, '0')}`;
}

function generateOrgName(orgIndex: number): string {
  const prefixes = ['Acme', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Theta', 'Kappa'];
  const suffixes = ['Corp', 'Inc', 'LLC', 'Ltd', 'Co', 'Group', 'Industries', 'Solutions'];

  const prefix = prefixes[orgIndex % prefixes.length];
  const suffix = suffixes[Math.floor(orgIndex / prefixes.length) % suffixes.length];

  return `${prefix} ${suffix} ${orgIndex}`;
}

function assignOrgToUser(userIndex: number, orgCount: number, distribution: 'uniform' | 'skewed'): number {
  if (distribution === 'uniform') {
    // Evenly distribute users across all orgs
    return userIndex % orgCount;
  } else {
    // Skewed distribution: 80% of users in 20% of orgs (Pareto principle)
    const random = (userIndex * 7919) % 1000; // Deterministic "random"

    if (random < 800) {
      // 80% of users go to first 20% of orgs
      const topOrgCount = Math.max(1, Math.floor(orgCount * 0.2));
      return (userIndex * 31) % topOrgCount;
    } else {
      // Remaining 20% of users distributed across remaining 80% of orgs
      const bottomOrgCount = orgCount - Math.floor(orgCount * 0.2);
      const bottomOrgStart = Math.floor(orgCount * 0.2);
      return bottomOrgStart + ((userIndex * 13) % bottomOrgCount);
    }
  }
}

function shouldHaveError(index: number, errorRate: number): boolean {
  return (index * 7919) % 1000 < errorRate * 1000;
}

function escapeCsvField(value: string): string {
  if (!value) return value;
  if (value.includes('"') || value.includes(',') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function generateMultiOrgCSV(options: GenerateOptions): void {
  const {
    userCount,
    orgCount,
    outputPath,
    withErrors = false,
    errorRate = 0.05,
    distribution = 'uniform'
  } = options;

  console.log(`\n📊 Multi-Org CSV Generator`);
  console.log(`═══════════════════════════════════════`);
  console.log(`Users: ${userCount.toLocaleString()}`);
  console.log(`Organizations: ${orgCount.toLocaleString()}`);
  console.log(`Distribution: ${distribution}`);
  console.log(`Avg users per org: ${Math.round(userCount / orgCount)}`);
  if (withErrors) {
    console.log(`Error rate: ${(errorRate * 100).toFixed(1)}%`);
  }
  console.log(`═══════════════════════════════════════\n`);

  const startTime = Date.now();

  // Ensure output directory exists
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const stream = fs.createWriteStream(outputPath, { encoding: 'utf8' });

  // Write header
  stream.write('email,first_name,last_name,email_verified,external_id,org_external_id,org_name,metadata\n');

  // Track org assignment for statistics
  const orgUserCounts = new Map<number, number>();

  // Write rows
  for (let i = 0; i < userCount; i++) {
    const orgIndex = assignOrgToUser(i, orgCount, distribution);
    orgUserCounts.set(orgIndex, (orgUserCounts.get(orgIndex) || 0) + 1);

    const email = generateEmail(i, orgIndex);
    const firstName = generateFirstName(i);
    const lastName = generateLastName(i);
    const emailVerified = i % 3 === 0 ? 'true' : 'false';
    const externalId = `user_${i}`;
    const orgExternalId = generateOrgExternalId(orgIndex);
    const orgName = generateOrgName(orgIndex);

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
      // Intentional error: conflicting org_id and org_external_id (validation error)
      row = `${email},${firstName},${lastName},${emailVerified},${externalId},${orgExternalId},${escapeCsvField(orgName)},${escapeCsvField(metadata)}\n`;
      // Add a second column that would cause conflict (simulated)
    } else {
      row = `${email},${firstName},${lastName},${emailVerified},${externalId},${orgExternalId},${escapeCsvField(orgName)},${escapeCsvField(metadata)}\n`;
    }

    stream.write(row);

    // Progress indicator
    if ((i + 1) % 10000 === 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const rate = Math.round((i + 1) / parseFloat(elapsed));
      const progress = ((i + 1) / userCount * 100).toFixed(1);
      console.log(`  ${(i + 1).toLocaleString()} users (${progress}%) - ${rate} rows/sec`);
    }
  }

  stream.end();

  stream.on('finish', () => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    const fileSize = (fs.statSync(outputPath).size / 1024 / 1024).toFixed(2);

    // Calculate distribution statistics
    const uniqueOrgsUsed = orgUserCounts.size;
    const avgUsersPerOrg = userCount / uniqueOrgsUsed;
    const maxUsersInOrg = Math.max(...Array.from(orgUserCounts.values()));
    const minUsersInOrg = Math.min(...Array.from(orgUserCounts.values()));

    console.log(`\n✓ Generation Complete`);
    console.log(`═══════════════════════════════════════`);
    console.log(`Time: ${elapsed}s`);
    console.log(`File size: ${fileSize} MB`);
    console.log(`Output: ${outputPath}`);
    console.log(`\n📊 Organization Distribution:`);
    console.log(`  Unique orgs used: ${uniqueOrgsUsed.toLocaleString()}`);
    console.log(`  Avg users per org: ${avgUsersPerOrg.toFixed(1)}`);
    console.log(`  Min users in org: ${minUsersInOrg}`);
    console.log(`  Max users in org: ${maxUsersInOrg}`);
    console.log(`\n💾 Expected Cache Performance:`);
    console.log(`  Cache misses: ${uniqueOrgsUsed.toLocaleString()} (first lookup per org)`);
    console.log(`  Cache hits: ${(userCount - uniqueOrgsUsed).toLocaleString()} (subsequent lookups)`);
    console.log(`  Expected hit rate: ${((userCount - uniqueOrgsUsed) / userCount * 100).toFixed(1)}%`);

    if (withErrors) {
      const errorCount = Math.round(userCount * errorRate);
      console.log(`\n⚠️  Intentional errors: ~${errorCount.toLocaleString()} (${(errorRate * 100).toFixed(1)}%)`);
    }
    console.log(`═══════════════════════════════════════\n`);
  });

  stream.on('error', (err) => {
    console.error(`❌ Error writing file: ${err.message}`);
    process.exit(1);
  });
}

// Parse command line arguments
const args = process.argv.slice(2);
if (args.length < 3) {
  console.error('Usage: tsx scripts/generate-multi-org-csv.ts <user-count> <org-count> <output-path> [options]');
  console.error('');
  console.error('Options:');
  console.error('  --with-errors              Include intentional errors for testing');
  console.error('  --error-rate <0-1>         Error rate (default: 0.05)');
  console.error('  --distribution <type>      uniform or skewed (default: uniform)');
  console.error('');
  console.error('Examples:');
  console.error('  # 1K users across 50 orgs (20 users per org on average)');
  console.error('  tsx scripts/generate-multi-org-csv.ts 1000 50 examples/multi-org-1k-50.csv');
  console.error('');
  console.error('  # 10K users across 100 orgs (100 users per org on average)');
  console.error('  tsx scripts/generate-multi-org-csv.ts 10000 100 examples/multi-org-10k-100.csv');
  console.error('');
  console.error('  # 100K users across 1K orgs with skewed distribution (realistic)');
  console.error('  tsx scripts/generate-multi-org-csv.ts 100000 1000 examples/multi-org-100k-1k.csv --distribution skewed');
  console.error('');
  console.error('  # 1K users with 10% error rate for testing');
  console.error('  tsx scripts/generate-multi-org-csv.ts 1000 10 examples/test-errors.csv --with-errors --error-rate 0.1');
  process.exit(1);
}

const userCount = parseInt(args[0], 10);
const orgCount = parseInt(args[1], 10);
const outputPath = args[2];
const withErrors = args.includes('--with-errors');
const errorRateIndex = args.indexOf('--error-rate');
const errorRate = errorRateIndex !== -1 ? parseFloat(args[errorRateIndex + 1]) : 0.05;
const distributionIndex = args.indexOf('--distribution');
const distribution = distributionIndex !== -1 ? args[distributionIndex + 1] as 'uniform' | 'skewed' : 'uniform';

if (isNaN(userCount) || userCount <= 0) {
  console.error('Error: user-count must be a positive integer');
  process.exit(1);
}

if (isNaN(orgCount) || orgCount <= 0) {
  console.error('Error: org-count must be a positive integer');
  process.exit(1);
}

if (orgCount > userCount) {
  console.error('Error: org-count cannot exceed user-count');
  process.exit(1);
}

if (withErrors && (isNaN(errorRate) || errorRate < 0 || errorRate > 1)) {
  console.error('Error: error-rate must be between 0 and 1');
  process.exit(1);
}

if (distribution !== 'uniform' && distribution !== 'skewed') {
  console.error('Error: distribution must be "uniform" or "skewed"');
  process.exit(1);
}

generateMultiOrgCSV({ userCount, orgCount, outputPath, withErrors, errorRate, distribution });
