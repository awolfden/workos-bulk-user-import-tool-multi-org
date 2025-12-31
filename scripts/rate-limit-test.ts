#!/usr/bin/env node
/**
 * Rate limiter verification test
 *
 * Tests that the rate limiter respects the configured limits:
 * - Sustained rate: 50 req/sec
 * - Burst capacity: configurable
 * - 10-second window: max 500 requests
 *
 * Usage:
 *   tsx scripts/rate-limit-test.ts
 */

import { RateLimiter } from '../src/rateLimiter.js';

interface TestResult {
  testName: string;
  passed: boolean;
  actualRate?: number;
  expectedRate: number;
  details: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testSustainedRate(
  tokensPerSecond: number,
  burstCapacity: number,
  duration: number = 5000
): Promise<TestResult> {
  console.log(`\n📊 Test: Sustained rate (${tokensPerSecond} req/sec for ${duration}ms)`);

  const limiter = new RateLimiter(tokensPerSecond, burstCapacity);
  const startTime = Date.now();
  let requestCount = 0;

  // Make requests for the specified duration
  while (Date.now() - startTime < duration) {
    await limiter.acquire();
    requestCount++;
  }

  const actualDuration = (Date.now() - startTime) / 1000;
  const actualRate = requestCount / actualDuration;

  limiter.stop();

  // Allow 5% tolerance
  const tolerance = tokensPerSecond * 0.05;
  const passed = Math.abs(actualRate - tokensPerSecond) <= tolerance;

  console.log(`  Requests: ${requestCount}`);
  console.log(`  Duration: ${actualDuration.toFixed(2)}s`);
  console.log(`  Actual rate: ${actualRate.toFixed(2)} req/sec`);
  console.log(`  Expected: ${tokensPerSecond} req/sec`);
  console.log(`  Result: ${passed ? '✅ PASS' : '❌ FAIL'}`);

  return {
    testName: 'Sustained Rate',
    passed,
    actualRate,
    expectedRate: tokensPerSecond,
    details: `${actualRate.toFixed(2)} req/sec (expected ${tokensPerSecond})`
  };
}

async function testBurstCapacity(
  tokensPerSecond: number,
  burstCapacity: number
): Promise<TestResult> {
  console.log(`\n📊 Test: Burst capacity (${burstCapacity} tokens)`);

  const limiter = new RateLimiter(tokensPerSecond, burstCapacity);
  const startTime = Date.now();
  let burstCount = 0;

  // Try to acquire as many as possible immediately
  const promises = [];
  for (let i = 0; i < burstCapacity + 10; i++) {
    promises.push(
      limiter.acquire().then(() => {
        const elapsed = Date.now() - startTime;
        if (elapsed < 100) { // Consider "immediate" if < 100ms
          burstCount++;
        }
      })
    );
  }

  await Promise.all(promises);
  const elapsed = Date.now() - startTime;

  limiter.stop();

  // Should get at least the burst capacity immediately (within 100ms)
  const passed = burstCount >= burstCapacity * 0.9; // 90% tolerance

  console.log(`  Immediate requests: ${burstCount}`);
  console.log(`  Expected: ${burstCapacity}`);
  console.log(`  Total time: ${elapsed}ms`);
  console.log(`  Result: ${passed ? '✅ PASS' : '❌ FAIL'}`);

  return {
    testName: 'Burst Capacity',
    passed,
    expectedRate: burstCapacity,
    details: `${burstCount} immediate requests (expected ${burstCapacity})`
  };
}

async function test10SecondWindow(
  tokensPerSecond: number,
  burstCapacity: number
): Promise<TestResult> {
  console.log(`\n📊 Test: 10-second window (max ${tokensPerSecond * 10} requests)`);

  const limiter = new RateLimiter(tokensPerSecond, burstCapacity);
  const windowSize = 10000; // 10 seconds
  const startTime = Date.now();
  let requestCount = 0;
  const requestTimes: number[] = [];

  // Make requests for 15 seconds to test sliding window
  while (Date.now() - startTime < 15000) {
    await limiter.acquire();
    requestCount++;
    requestTimes.push(Date.now());
  }

  limiter.stop();

  // Check any 10-second window doesn't exceed limit
  const maxAllowed = tokensPerSecond * 10;
  let maxInWindow = 0;

  for (let i = 0; i < requestTimes.length; i++) {
    const windowEnd = requestTimes[i] + windowSize;
    let countInWindow = 0;

    for (let j = i; j < requestTimes.length && requestTimes[j] <= windowEnd; j++) {
      countInWindow++;
    }

    maxInWindow = Math.max(maxInWindow, countInWindow);
  }

  const passed = maxInWindow <= maxAllowed * 1.05; // 5% tolerance

  console.log(`  Total requests: ${requestCount}`);
  console.log(`  Max in any 10s window: ${maxInWindow}`);
  console.log(`  Limit: ${maxAllowed}`);
  console.log(`  Result: ${passed ? '✅ PASS' : '❌ FAIL'}`);

  return {
    testName: '10-Second Window',
    passed,
    expectedRate: maxAllowed,
    details: `Max ${maxInWindow} in 10s (limit ${maxAllowed})`
  };
}

async function testConcurrency(
  tokensPerSecond: number,
  burstCapacity: number,
  concurrency: number
): Promise<TestResult> {
  console.log(`\n📊 Test: Concurrent requests (${concurrency} workers)`);

  const limiter = new RateLimiter(tokensPerSecond, burstCapacity);
  const duration = 5000;
  const startTime = Date.now();
  let totalRequests = 0;

  // Spawn concurrent workers
  const workers = Array.from({ length: concurrency }, async () => {
    let workerRequests = 0;
    while (Date.now() - startTime < duration) {
      await limiter.acquire();
      workerRequests++;
    }
    return workerRequests;
  });

  const results = await Promise.all(workers);
  totalRequests = results.reduce((a, b) => a + b, 0);

  const actualDuration = (Date.now() - startTime) / 1000;
  const actualRate = totalRequests / actualDuration;

  limiter.stop();

  const tolerance = tokensPerSecond * 0.05;
  const passed = Math.abs(actualRate - tokensPerSecond) <= tolerance;

  console.log(`  Workers: ${concurrency}`);
  console.log(`  Total requests: ${totalRequests}`);
  console.log(`  Actual rate: ${actualRate.toFixed(2)} req/sec`);
  console.log(`  Expected: ${tokensPerSecond} req/sec`);
  console.log(`  Result: ${passed ? '✅ PASS' : '❌ FAIL'}`);

  return {
    testName: 'Concurrency',
    passed,
    actualRate,
    expectedRate: tokensPerSecond,
    details: `${actualRate.toFixed(2)} req/sec with ${concurrency} workers`
  };
}

async function runTests() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('WorkOS Rate Limiter Verification Tests');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('Target: 500 requests per 10 seconds (50 req/sec)');
  console.log('');

  const results: TestResult[] = [];

  // Test configurations
  const tokensPerSecond = 50;
  const currentBurst = 50;    // Current implementation
  const workOSBurst = 500;    // WorkOS actual limit

  console.log('\n🔹 Testing with CURRENT burst capacity (50)');
  results.push(await testSustainedRate(tokensPerSecond, currentBurst, 5000));
  results.push(await testBurstCapacity(tokensPerSecond, currentBurst));
  results.push(await test10SecondWindow(tokensPerSecond, currentBurst));
  results.push(await testConcurrency(tokensPerSecond, currentBurst, 10));

  console.log('\n\n🔹 Testing with WORKOS burst capacity (500)');
  results.push(await testSustainedRate(tokensPerSecond, workOSBurst, 5000));
  results.push(await testBurstCapacity(tokensPerSecond, workOSBurst));
  results.push(await test10SecondWindow(tokensPerSecond, workOSBurst));
  results.push(await testConcurrency(tokensPerSecond, workOSBurst, 20));

  // Summary
  console.log('\n\n═══════════════════════════════════════════════════════════════');
  console.log('Test Summary');
  console.log('═══════════════════════════════════════════════════════════════');

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  results.forEach(result => {
    const icon = result.passed ? '✅' : '❌';
    console.log(`${icon} ${result.testName}: ${result.details}`);
  });

  console.log('');
  console.log(`Total: ${results.length} tests`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);

  if (failed === 0) {
    console.log('\n✅ All tests passed! Rate limiter respects WorkOS limits.');
  } else {
    console.log('\n⚠️  Some tests failed. Review rate limiter configuration.');
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
}

runTests().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
