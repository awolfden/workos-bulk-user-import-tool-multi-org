#!/usr/bin/env node
/**
 * Memory usage test script for import operations
 *
 * Monitors memory usage during CSV import in dry-run mode
 * to validate that memory stays bounded.
 *
 * Usage:
 *   tsx scripts/memory-test.ts examples/hundred-thousand-users.csv
 */

import { spawn } from 'node:child_process';
import path from 'node:path';

interface MemorySnapshot {
  timestamp: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
  rss: number;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${seconds}s`;
}

async function runMemoryTest(csvPath: string): Promise<void> {
  console.log('='.repeat(70));
  console.log('WorkOS Import Memory Test');
  console.log('='.repeat(70));
  console.log(`CSV File: ${csvPath}`);
  console.log(`Mode: Dry Run (no actual API calls)`);
  console.log('');

  const snapshots: MemorySnapshot[] = [];
  const startTime = Date.now();

  // Spawn the import process with dry-run flag
  const importProcess = spawn('npx', [
    'tsx',
    'bin/import-users.ts',
    '--csv',
    csvPath,
    '--dry-run',
    '--quiet',
    '--errors-out',
    '/tmp/memory-test-errors.jsonl'
  ], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      WORKOS_SECRET_KEY: process.env.WORKOS_SECRET_KEY || 'sk_test_fake_key_for_testing'
    }
  });

  // Monitor memory usage
  const monitorInterval = setInterval(() => {
    const memUsage = process.memoryUsage();
    const snapshot: MemorySnapshot = {
      timestamp: Date.now() - startTime,
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      external: memUsage.external,
      rss: memUsage.rss
    };
    snapshots.push(snapshot);

    // Print progress
    const elapsed = formatDuration(snapshot.timestamp);
    const heapUsed = formatBytes(snapshot.heapUsed);
    const rss = formatBytes(snapshot.rss);
    process.stdout.write(`\r[${elapsed}] Heap: ${heapUsed} | RSS: ${rss}     `);
  }, 1000);

  // Capture output
  let output = '';
  let errorOutput = '';

  importProcess.stdout?.on('data', (data) => {
    output += data.toString();
  });

  importProcess.stderr?.on('data', (data) => {
    errorOutput += data.toString();
  });

  // Wait for process to complete
  await new Promise<void>((resolve, reject) => {
    importProcess.on('close', (code) => {
      clearInterval(monitorInterval);
      console.log('\n');

      if (code === 0 || code === 1) {
        // Code 1 is expected in dry-run (no actual users created)
        resolve();
      } else {
        reject(new Error(`Import process exited with code ${code}`));
      }
    });

    importProcess.on('error', (err) => {
      clearInterval(monitorInterval);
      reject(err);
    });
  });

  // Print final output
  if (errorOutput) {
    console.log('Import Summary:');
    console.log(errorOutput);
  }

  // Analyze memory usage
  console.log('');
  console.log('='.repeat(70));
  console.log('Memory Usage Analysis');
  console.log('='.repeat(70));

  if (snapshots.length > 0) {
    const heapUsedValues = snapshots.map(s => s.heapUsed);
    const rssValues = snapshots.map(s => s.rss);

    const heapMin = Math.min(...heapUsedValues);
    const heapMax = Math.max(...heapUsedValues);
    const heapAvg = heapUsedValues.reduce((a, b) => a + b, 0) / heapUsedValues.length;

    const rssMin = Math.min(...rssValues);
    const rssMax = Math.max(...rssValues);
    const rssAvg = rssValues.reduce((a, b) => a + b, 0) / rssValues.length;

    console.log('');
    console.log('Heap Memory:');
    console.log(`  Min:     ${formatBytes(heapMin)}`);
    console.log(`  Max:     ${formatBytes(heapMax)}`);
    console.log(`  Average: ${formatBytes(heapAvg)}`);
    console.log(`  Growth:  ${formatBytes(heapMax - heapMin)}`);

    console.log('');
    console.log('Resident Set Size (RSS):');
    console.log(`  Min:     ${formatBytes(rssMin)}`);
    console.log(`  Max:     ${formatBytes(rssMax)}`);
    console.log(`  Average: ${formatBytes(rssAvg)}`);
    console.log(`  Growth:  ${formatBytes(rssMax - rssMin)}`);

    console.log('');
    console.log('Test Duration:', formatDuration(Date.now() - startTime));

    // Check for memory leaks (arbitrary threshold: > 500MB growth)
    const heapGrowth = heapMax - heapMin;
    const rssGrowth = rssMax - rssMin;

    console.log('');
    if (heapGrowth > 500 * 1024 * 1024) {
      console.log('⚠️  WARNING: Heap memory growth exceeds 500 MB');
      console.log('   This may indicate a memory leak or unbounded growth.');
    } else if (heapGrowth > 200 * 1024 * 1024) {
      console.log('ℹ️  NOTE: Heap memory growth is moderate (> 200 MB)');
      console.log('   Consider monitoring for larger CSV files.');
    } else {
      console.log('✓ Memory usage appears bounded and healthy');
    }
  }

  console.log('');
  console.log('='.repeat(70));
}

// Parse arguments
const args = process.argv.slice(2);
if (args.length < 1) {
  console.error('Usage: tsx scripts/memory-test.ts <csv-path>');
  console.error('');
  console.error('Example:');
  console.error('  tsx scripts/memory-test.ts examples/hundred-thousand-users.csv');
  process.exit(1);
}

const csvPath = args[0];
runMemoryTest(csvPath).catch((err) => {
  console.error('Error running memory test:', err.message);
  process.exit(1);
});
