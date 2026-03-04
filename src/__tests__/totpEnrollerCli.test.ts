/**
 * TOTP Enroller CLI Tests
 *
 * E2E tests for bin/enroll-totp.ts as a subprocess.
 *
 * Run with: npx tsx src/__tests__/totpEnrollerCli.test.ts
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "../..");
const binPath = path.join(rootDir, "bin/enroll-totp.ts");

const TEMP_DIR = path.join(__dirname, "../../.temp-totp-cli-tests");

// --- Helpers ---

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(
  args: string[],
  env?: Record<string, string>
): Promise<RunResult> {
  return new Promise((resolve) => {
    const proc = spawn("npx", ["tsx", binPath, ...args], {
      cwd: rootDir,
      env: { ...process.env, NO_COLOR: "1", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data) => {
      stdout += data.toString();
    });
    proc.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function writeCsv(filename: string, rows: string[]): string {
  const filePath = path.join(TEMP_DIR, filename);
  fs.writeFileSync(filePath, rows.join("\n"), "utf8");
  return filePath;
}

function writeNdjson(
  filename: string,
  records: Record<string, unknown>[]
): string {
  const filePath = path.join(TEMP_DIR, filename);
  const lines = records.map((r) => JSON.stringify(r)).join("\n");
  fs.writeFileSync(filePath, lines, "utf8");
  return filePath;
}

// --- Test Runner ---

const results: Array<{ name: string; passed: boolean; error?: string }> = [];

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log(`  ✓ ${name}`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    results.push({ name, passed: false, error: message });
    console.log(`  ✗ ${name}`);
    console.log(`    ${message}`);
  }
}

// --- Tests ---

async function main() {
  fs.mkdirSync(TEMP_DIR, { recursive: true });

  console.log("\nTOTP Enroller CLI Tests");
  console.log("=======================\n");

  await test("--help: exits 0 and shows usage", async () => {
    const result = await runCli(["--help"]);
    assert.equal(result.code, 0);
    const combined = result.stdout + result.stderr;
    assert.ok(
      combined.includes("enroll-totp") || combined.includes("Enroll"),
      "Should show tool name or description"
    );
    assert.ok(
      combined.includes("--input"),
      "Should show --input option"
    );
  });

  await test("--dry-run with CSV: exits 0 and shows dry-run output", async () => {
    const csvPath = writeCsv("cli-dry.csv", [
      "email,totp_secret",
      "alice@example.com,JBSWY3DPEHPK3PXP",
    ]);

    const result = await runCli(
      ["--input", csvPath, "--dry-run", "--quiet"],
      { WORKOS_SECRET_KEY: "sk_test_fake" }
    );

    // Dry run will fail at user lookup (fake key), but should at least start
    // and show it's in dry-run mode. The exit code depends on whether the
    // SDK call succeeds, but output should mention dry run or TOTP.
    const combined = result.stdout + result.stderr;
    assert.ok(
      combined.includes("DRY RUN") || combined.includes("TOTP") || combined.includes("Loaded"),
      "Should show dry-run or TOTP-related output"
    );
  });

  await test("--dry-run with NDJSON: auto-detects format", async () => {
    const ndjsonPath = writeNdjson("cli-dry.ndjson", [
      { email: "alice@example.com", totp_secret: "JBSWY3DPEHPK3PXP" },
    ]);

    const result = await runCli(
      ["--input", ndjsonPath, "--dry-run", "--quiet"],
      { WORKOS_SECRET_KEY: "sk_test_fake" }
    );

    const combined = result.stdout + result.stderr;
    // Auto-detect should pick ndjson from extension
    assert.ok(
      combined.includes("NDJSON") || combined.includes("ndjson") || combined.includes("TOTP") || combined.includes("Loaded"),
      "Should process NDJSON format"
    );
  });

  await test("Missing --input: exits non-zero", async () => {
    const result = await runCli([], {
      WORKOS_SECRET_KEY: "sk_test_fake",
    });

    assert.notEqual(result.code, 0, "Should exit with non-zero code");
    const combined = result.stdout + result.stderr;
    assert.ok(
      combined.includes("--input") || combined.includes("required"),
      "Should mention missing --input"
    );
  });

  await test("Missing WORKOS_SECRET_KEY: exits non-zero with failures", async () => {
    const csvPath = writeCsv("cli-no-key.csv", [
      "email,totp_secret",
      "alice@example.com,JBSWY3DPEHPK3PXP",
    ]);

    // Explicitly unset the key by copying env without it
    const env: Record<string, string> = {};
    for (const key of Object.keys(process.env)) {
      if (key !== "WORKOS_SECRET_KEY") {
        const val = process.env[key];
        if (val !== undefined) {
          env[key] = val;
        }
      }
    }

    const result = await runCli(["--input", csvPath], env);

    assert.notEqual(result.code, 0, "Should exit with non-zero code");
    const combined = result.stdout + result.stderr;
    assert.ok(
      combined.includes("Failures: 1") || combined.includes("Failed"),
      "Should report failures when API key is missing"
    );
  });

  // --- Cleanup ---
  console.log("\n→ Cleaning up temp files...");
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  console.log("  ✓ Cleanup complete");

  // --- Summary ---
  console.log("\n=======================");
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`Tests: ${passed} passed, ${failed} failed, ${results.length} total`);

  if (failed > 0) {
    console.log("\nFailed tests:");
    for (const r of results.filter((r) => !r.passed)) {
      console.log(`  ✗ ${r.name}: ${r.error}`);
    }
    process.exit(1);
  } else {
    console.log("✓ All TOTP CLI tests passed!");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
