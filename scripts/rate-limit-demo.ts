#!/usr/bin/env node
/**
 * Rate limiter demonstration - shows it in action
 */

import { RateLimiter } from '../src/rateLimiter.js';

async function demo() {
  console.log('Rate Limiter Demonstration');
  console.log('=========================\n');
  console.log('Making 150 requests with 50 req/sec limit...\n');

  const limiter = new RateLimiter(50, 50);
  const startTime = Date.now();
  const requestTimes: number[] = [];

  // Make 150 requests
  for (let i = 0; i < 150; i++) {
    await limiter.acquire();
    const elapsed = Date.now() - startTime;
    requestTimes.push(elapsed);

    // Log every 10th request
    if ((i + 1) % 10 === 0) {
      const rate = ((i + 1) / elapsed) * 1000;
      console.log(`Request ${(i + 1).toString().padStart(3)}: ${elapsed.toString().padStart(5)}ms elapsed, rate: ${rate.toFixed(1)} req/sec`);
    }
  }

  limiter.stop();

  const totalTime = Date.now() - startTime;
  const overallRate = (150 / totalTime) * 1000;

  console.log('\n' + '='.repeat(60));
  console.log(`Total time: ${totalTime}ms (${(totalTime/1000).toFixed(2)}s)`);
  console.log(`Overall rate: ${overallRate.toFixed(2)} req/sec`);
  console.log(`Expected: ~50 req/sec`);
  console.log(`Difference: ${Math.abs(overallRate - 50).toFixed(2)} req/sec`);

  if (overallRate > 55) {
    console.log('\n❌ FAIL: Exceeded rate limit!');
  } else {
    console.log('\n✅ PASS: Rate limit respected!');
  }

  console.log('='.repeat(60));
}

demo().catch(console.error);
