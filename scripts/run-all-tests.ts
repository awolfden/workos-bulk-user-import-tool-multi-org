/**
 * Unified Test Runner
 *
 * Runs all tests in sequence and reports results
 *
 * Usage: npm test
 * Or:    npx tsx scripts/run-all-tests.ts
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  output?: string;
  error?: string;
}

/**
 * Run a command and capture output
 */
async function runCommand(
  command: string,
  args: string[],
  cwd: string = rootDir
): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });

    let output = '';
    proc.stdout?.on('data', (data) => { output += data.toString(); });
    proc.stderr?.on('data', (data) => { output += data.toString(); });

    proc.on('close', (code) => {
      resolve({ code: code ?? 0, output });
    });
  });
}

/**
 * Run a single test
 */
async function runTest(name: string, command: string, args: string[]): Promise<TestResult> {
  const startTime = Date.now();

  try {
    const result = await runCommand(command, args);
    const duration = Date.now() - startTime;

    return {
      name,
      passed: result.code === 0,
      duration,
      output: result.code === 0 ? undefined : result.output,
      error: result.code !== 0 ? `Exit code ${result.code}` : undefined
    };
  } catch (err: any) {
    const duration = Date.now() - startTime;
    return {
      name,
      passed: false,
      duration,
      error: err.message
    };
  }
}

/**
 * Cleanup test artifacts
 */
async function cleanup() {
  const fs = await import('node:fs');

  // Remove test checkpoints
  const checkpointDir = path.join(rootDir, '.workos-checkpoints');
  if (fs.existsSync(checkpointDir)) {
    const dirs = fs.readdirSync(checkpointDir);
    for (const dir of dirs) {
      if (dir.startsWith('e2e-test-') || dir.startsWith('bench-')) {
        const fullPath = path.join(checkpointDir, dir);
        fs.rmSync(fullPath, { recursive: true, force: true });
      }
    }
  }

  // Remove benchmark temp files
  const tempDir = path.join(rootDir, '.temp-benchmark');
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * Main test runner
 */
async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  WorkOS User Importer - Test Suite');
  console.log('═══════════════════════════════════════════════════════════\n');

  const results: TestResult[] = [];

  // Test 1: TypeScript Compilation
  console.log('→ Test 1: TypeScript Compilation');
  results.push(await runTest(
    'TypeScript Compilation',
    'npm',
    ['run', 'typecheck']
  ));
  console.log(results[results.length - 1].passed ? '  ✓ Passed' : '  ✗ Failed');
  console.log(`  Duration: ${results[results.length - 1].duration}ms\n`);

  // Only continue if compilation passes
  if (!results[results.length - 1].passed) {
    console.log('⚠ Compilation failed. Skipping remaining tests.\n');
    printSummary(results);
    process.exit(1);
  }

  // Test 2: Module Tests
  console.log('→ Test 2: Module Verification');
  results.push(await runTest(
    'Module Verification',
    'npx',
    ['tsx', 'src/workers/__test-distributedRateLimiter.ts']
  ));
  console.log(results[results.length - 1].passed ? '  ✓ Passed' : '  ✗ Failed');
  console.log(`  Duration: ${results[results.length - 1].duration}ms\n`);

  // Compile workers for remaining tests
  console.log('→ Compiling workers...');
  await runCommand('npx', [
    'tsc',
    'src/workers/*.ts',
    '--outDir', 'dist/workers',
    '--module', 'esnext',
    '--moduleResolution', 'bundler',
    '--target', 'es2021',
    '--skipLibCheck',
    '--esModuleInterop',
    '--resolveJsonModule',
    '--strict'
  ]);
  console.log('  ✓ Workers compiled\n');

  // Test 3: Worker Isolation
  console.log('→ Test 3: Worker Isolation');
  results.push(await runTest(
    'Worker Isolation',
    'npx',
    ['tsx', 'src/workers/__test-worker.ts']
  ));
  console.log(results[results.length - 1].passed ? '  ✓ Passed' : '  ✗ Failed');
  console.log(`  Duration: ${results[results.length - 1].duration}ms\n`);

  // Test 4: Integration Test
  console.log('→ Test 4: Coordinator Integration (2 workers)');
  results.push(await runTest(
    'Coordinator Integration',
    'npx',
    ['tsx', 'src/workers/__test-coordinator.ts']
  ));
  console.log(results[results.length - 1].passed ? '  ✓ Passed' : '  ✗ Failed');
  console.log(`  Duration: ${results[results.length - 1].duration}ms\n`);

  // Test 5: E2E Single Worker
  console.log('→ Test 5: End-to-End (Single Worker)');
  results.push(await runTest(
    'E2E Single Worker',
    'npx',
    [
      'tsx', 'bin/import-users.ts',
      '--csv', 'examples/phase3-test-simple.csv',
      '--job-id', 'e2e-test-single',
      '--dry-run',
      '--workers', '1',
      '--chunk-size', '2'
    ]
  ));
  console.log(results[results.length - 1].passed ? '  ✓ Passed' : '  ✗ Failed');
  console.log(`  Duration: ${results[results.length - 1].duration}ms\n`);

  // Test 6: E2E Multi Worker
  console.log('→ Test 6: End-to-End (Multiple Workers)');
  results.push(await runTest(
    'E2E Multiple Workers',
    'npx',
    [
      'tsx', 'bin/import-users.ts',
      '--csv', 'examples/phase3-chunk-test.csv',
      '--job-id', 'e2e-test-multi',
      '--dry-run',
      '--workers', '2',
      '--chunk-size', '3'
    ]
  ));
  console.log(results[results.length - 1].passed ? '  ✓ Passed' : '  ✗ Failed');
  console.log(`  Duration: ${results[results.length - 1].duration}ms\n`);

  // Cleanup
  console.log('→ Cleaning up test artifacts...');
  await cleanup();
  console.log('  ✓ Cleanup complete\n');

  // Print summary
  printSummary(results);

  // Exit with appropriate code
  const allPassed = results.every(r => r.passed);
  process.exit(allPassed ? 0 : 1);
}

/**
 * Print test summary
 */
function printSummary(results: TestResult[]) {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Test Summary');
  console.log('═══════════════════════════════════════════════════════════\n');

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const total = results.length;
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

  console.log(`Tests:    ${passed} passed, ${failed} failed, ${total} total`);
  console.log(`Duration: ${(totalDuration / 1000).toFixed(2)}s\n`);

  // Show details for each test
  console.log('Test Results:');
  for (const result of results) {
    const status = result.passed ? '✓' : '✗';
    const duration = `${result.duration}ms`;
    console.log(`  ${status} ${result.name.padEnd(30)} ${duration.padStart(10)}`);

    if (!result.passed && result.error) {
      console.log(`    Error: ${result.error}`);
    }
  }

  console.log('');

  if (failed === 0) {
    console.log('✓ All tests passed! 🎉');
  } else {
    console.log(`✗ ${failed} test(s) failed`);

    // Show output for failed tests
    console.log('\nFailed Test Output:\n');
    for (const result of results.filter(r => !r.passed)) {
      console.log(`─── ${result.name} ───`);
      if (result.output) {
        console.log(result.output.slice(-500)); // Last 500 chars
      }
      console.log('');
    }
  }
}

// Run tests
main().catch((err) => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
