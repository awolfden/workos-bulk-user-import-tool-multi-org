/**
 * Phase 4.5: Performance benchmarking script
 *
 * Tests worker pool performance with different worker counts
 * Measures throughput, duration, and validates scaling characteristics
 *
 * Run with: npx tsx scripts/benchmark-workers.ts
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface BenchmarkResult {
  workers: number;
  totalUsers: number;
  durationMs: number;
  usersPerSecond: number;
  chunksCompleted: number;
  speedup: number;
}

/**
 * Run a single benchmark with specified worker count
 */
async function runBenchmark(workers: number, csvPath: string, totalUsers: number): Promise<BenchmarkResult> {
  const jobId = `bench-${workers}w-${Date.now()}`;
  const checkpointDir = path.join(__dirname, '../.workos-checkpoints');

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Benchmark: ${workers} worker(s)`);
  console.log(`${'='.repeat(60)}`);

  // Import dynamically to ensure fresh modules
  const { spawn } = await import('node:child_process');

  const startTime = Date.now();

  // Run import with specified worker count
  const args = [
    'bin/import-users.ts',
    '--csv', csvPath,
    '--job-id', jobId,
    '--workers', workers.toString(),
    '--chunk-size', '10', // Small chunks for better parallelization
    '--dry-run'
  ];

  const result = await new Promise<{ code: number; output: string }>((resolve) => {
    const proc = spawn('npx', ['tsx', ...args], {
      cwd: path.join(__dirname, '..'),
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let output = '';
    proc.stdout?.on('data', (data) => {
      output += data.toString();
    });
    proc.stderr?.on('data', (data) => {
      output += data.toString();
    });

    proc.on('close', (code) => {
      resolve({ code: code ?? 0, output });
    });
  });

  const endTime = Date.now();
  const durationMs = endTime - startTime;

  // Clean up checkpoint
  const jobDir = path.join(checkpointDir, jobId);
  if (fs.existsSync(jobDir)) {
    fs.rmSync(jobDir, { recursive: true });
  }

  // Parse output for chunk count
  const chunkMatch = result.output.match(/(\d+)\/(\d+) chunks/);
  const chunksCompleted = chunkMatch ? parseInt(chunkMatch[1]) : 0;

  const usersPerSecond = (totalUsers / durationMs) * 1000;

  return {
    workers,
    totalUsers,
    durationMs,
    usersPerSecond,
    chunksCompleted,
    speedup: 0 // Will be calculated later
  };
}

/**
 * Generate a test CSV with specified number of users
 */
function generateTestCSV(userCount: number): string {
  const tempDir = path.join(__dirname, '../.temp-benchmark');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const csvPath = path.join(tempDir, `benchmark-${userCount}.csv`);

  const rows = ['email,first_name,last_name'];
  for (let i = 1; i <= userCount; i++) {
    rows.push(`benchmark${i}@example.com,User,${i}`);
  }

  fs.writeFileSync(csvPath, rows.join('\n'));
  return csvPath;
}

/**
 * Format number with commas
 */
function formatNumber(num: number): string {
  return num.toLocaleString('en-US', { maximumFractionDigits: 1 });
}

/**
 * Main benchmark runner
 */
async function main() {
  console.log('Phase 4.5: Worker Pool Performance Benchmark');
  console.log('============================================\n');

  // Configuration
  const userCount = 100; // Small dataset for quick benchmarks
  const workerCounts = [1, 2, 4];

  // Add 8 workers if CPU count allows
  const os = await import('node:os');
  const cpuCount = os.cpus().length;
  if (cpuCount >= 8) {
    workerCounts.push(8);
  }

  console.log(`Test Configuration:`);
  console.log(`  Total users: ${userCount}`);
  console.log(`  Worker counts: ${workerCounts.join(', ')}`);
  console.log(`  CPU count: ${cpuCount}`);
  console.log(`  Chunk size: 10 users`);
  console.log(`  Mode: Dry run`);

  // Generate test CSV
  console.log(`\nGenerating test CSV...`);
  const csvPath = generateTestCSV(userCount);
  console.log(`  CSV created: ${csvPath}`);

  // Run benchmarks
  const results: BenchmarkResult[] = [];

  for (const workers of workerCounts) {
    try {
      const result = await runBenchmark(workers, csvPath, userCount);
      results.push(result);

      console.log(`\nResults:`);
      console.log(`  Duration: ${result.durationMs}ms`);
      console.log(`  Throughput: ${formatNumber(result.usersPerSecond)} users/sec`);
      console.log(`  Chunks completed: ${result.chunksCompleted}`);
    } catch (err) {
      console.error(`  ✗ Benchmark failed:`, err);
    }
  }

  // Calculate speedups relative to single worker
  const baseline = results[0];
  if (baseline) {
    for (const result of results) {
      result.speedup = baseline.durationMs / result.durationMs;
    }
  }

  // Display summary table
  console.log(`\n${'='.repeat(80)}`);
  console.log('PERFORMANCE SUMMARY');
  console.log('='.repeat(80));
  console.log('');
  console.log('| Workers | Duration | Throughput      | Speedup | Efficiency |');
  console.log('|---------|----------|-----------------|---------|------------|');

  for (const result of results) {
    const efficiency = (result.speedup / result.workers) * 100;
    console.log(
      `| ${result.workers.toString().padStart(7)} ` +
      `| ${formatNumber(result.durationMs).padStart(7)}ms ` +
      `| ${formatNumber(result.usersPerSecond).padStart(9)} u/s ` +
      `| ${result.speedup.toFixed(2).padStart(7)}x ` +
      `| ${efficiency.toFixed(1).padStart(9)}% |`
    );
  }

  console.log('');

  // Analysis
  console.log('\nANALYSIS:');

  if (results.length >= 2) {
    const twoWorkerResult = results.find(r => r.workers === 2);
    const fourWorkerResult = results.find(r => r.workers === 4);

    if (twoWorkerResult) {
      const twoWorkerEfficiency = (twoWorkerResult.speedup / 2) * 100;
      console.log(`  • 2 workers: ${twoWorkerResult.speedup.toFixed(2)}x speedup (${twoWorkerEfficiency.toFixed(0)}% efficiency)`);
      if (twoWorkerEfficiency >= 80) {
        console.log(`    ✓ Good scaling efficiency`);
      } else {
        console.log(`    ⚠ Lower than expected (target: 80%+)`);
      }
    }

    if (fourWorkerResult) {
      const fourWorkerEfficiency = (fourWorkerResult.speedup / 4) * 100;
      console.log(`  • 4 workers: ${fourWorkerResult.speedup.toFixed(2)}x speedup (${fourWorkerEfficiency.toFixed(0)}% efficiency)`);
      if (fourWorkerEfficiency >= 70) {
        console.log(`    ✓ Good scaling efficiency`);
      } else {
        console.log(`    ⚠ Lower than expected (target: 70%+)`);
      }
    }
  }

  console.log('\nNOTE: These benchmarks use dry-run mode with a small dataset.');
  console.log('Real-world performance with API calls will be limited by the 50 rps rate limit.');
  console.log('Expected production throughput: ~20 users/sec (1 worker) → ~80 users/sec (4 workers)');

  // Cleanup
  console.log('\nCleaning up...');
  const tempDir = path.join(__dirname, '../.temp-benchmark');
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true });
  }

  console.log('\n✓ Benchmark complete!');
}

// Run benchmark
main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
