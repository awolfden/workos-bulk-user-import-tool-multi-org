/**
 * TOTP Enroller Tests
 *
 * Unit + integration tests for enrollTotpFactors() with mocked WorkOS SDK.
 *
 * Run with: npx tsx src/__tests__/totpEnroller.test.ts
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Mock Setup ---
// Set env before any imports that use getWorkOSClient
process.env.WORKOS_SECRET_KEY = "sk_test_fake_key_for_tests";

// We need to intercept the workos module. Since getWorkOSClient() caches the
// client, we'll import the module and replace the cached client via a
// re-export hack: import the workos module, then call getWorkOSClient() once
// to initialize it, then mutate the returned object's userManagement property.

const TEMP_DIR = path.join(__dirname, "../../.temp-totp-tests");

// --- Helpers ---

interface MockUser {
  id: string;
  email: string;
}

interface EnrollCall {
  userId: string;
  type: string;
  totpSecret: string;
  totpIssuer?: string;
  totpUser?: string;
}

function createMockWorkOS(users: MockUser[], opts?: {
  enrollError?: (call: EnrollCall) => Error | null;
}) {
  const enrollCalls: EnrollCall[] = [];

  const mockUserManagement = {
    listUsers: async ({ email }: { email: string }) => {
      const matches = users.filter(
        (u) => u.email.toLowerCase() === email.toLowerCase()
      );
      return { data: matches };
    },
    enrollAuthFactor: async (params: EnrollCall) => {
      enrollCalls.push(params);
      if (opts?.enrollError) {
        const err = opts.enrollError(params);
        if (err) throw err;
      }
      return { authenticationFactor: {}, authenticationChallenge: {} };
    },
  };

  return { userManagement: mockUserManagement, enrollCalls };
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

// --- Install mock into the module system ---

// Import the workos module to trigger caching, then monkey-patch
import * as workosModule from "../workos.js";

let currentMock: ReturnType<typeof createMockWorkOS> | null = null;

// Get the real client object created by the module (it will be cached)
const realClient = workosModule.getWorkOSClient();

// Save original userManagement so we can restore
const originalUserManagement = realClient.userManagement;

function installMock(mock: ReturnType<typeof createMockWorkOS>) {
  currentMock = mock;
  // Replace the userManagement property on the cached WorkOS instance
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (realClient as never as Record<string, unknown>).userManagement =
    mock.userManagement;
}

function restoreMock() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (realClient as never as Record<string, unknown>).userManagement =
    originalUserManagement;
  currentMock = null;
}

// --- Import the module under test AFTER mock setup ---
const { enrollTotpFactors } = await import("../totpEnroller.js");

// --- Test Suite ---

async function main() {
  // Setup temp directory
  fs.mkdirSync(TEMP_DIR, { recursive: true });

  console.log("\nTOTP Enroller Tests");
  console.log("===================\n");

  // ------ CSV Parsing ------

  await test("CSV: parses email and totp_secret columns", async () => {
    const csvPath = writeCsv("basic.csv", [
      "email,totp_secret",
      "alice@example.com,JBSWY3DPEHPK3PXP",
      "bob@example.com,JBSWY3DPEHPK3PXQ",
    ]);

    const mock = createMockWorkOS([
      { id: "user_alice", email: "alice@example.com" },
      { id: "user_bob", email: "bob@example.com" },
    ]);
    installMock(mock);

    const { summary } = await enrollTotpFactors({
      inputPath: csvPath,
      format: "csv",
      quiet: true,
      concurrency: 1,
    });

    assert.equal(summary.total, 2);
    assert.equal(summary.enrolled, 2);
    assert.equal(mock.enrollCalls.length, 2);
    assert.equal(mock.enrollCalls[0]!.totpSecret, "JBSWY3DPEHPK3PXP");
    assert.equal(mock.enrollCalls[1]!.totpSecret, "JBSWY3DPEHPK3PXQ");
    restoreMock();
  });

  await test("CSV: includes optional totp_issuer and totp_user", async () => {
    const csvPath = writeCsv("optional-cols.csv", [
      "email,totp_secret,totp_issuer,totp_user",
      "alice@example.com,JBSWY3DPEHPK3PXP,MyApp,alice",
    ]);

    const mock = createMockWorkOS([
      { id: "user_alice", email: "alice@example.com" },
    ]);
    installMock(mock);

    await enrollTotpFactors({
      inputPath: csvPath,
      format: "csv",
      quiet: true,
      concurrency: 1,
    });

    assert.equal(mock.enrollCalls.length, 1);
    assert.equal(mock.enrollCalls[0]!.totpIssuer, "MyApp");
    assert.equal(mock.enrollCalls[0]!.totpUser, "alice");
    restoreMock();
  });

  await test("CSV: skips rows missing email or totp_secret", async () => {
    const csvPath = writeCsv("skip-invalid.csv", [
      "email,totp_secret",
      ",JBSWY3DPEHPK3PXP",
      "bob@example.com,",
      "alice@example.com,JBSWY3DPEHPK3PXP",
    ]);

    const mock = createMockWorkOS([
      { id: "user_alice", email: "alice@example.com" },
    ]);
    installMock(mock);

    const { summary } = await enrollTotpFactors({
      inputPath: csvPath,
      format: "csv",
      quiet: true,
      concurrency: 1,
    });

    assert.equal(summary.total, 1, "Only valid rows should be counted");
    assert.equal(summary.enrolled, 1);
    restoreMock();
  });

  // ------ NDJSON Parsing ------

  await test("NDJSON: parses email and totp_secret fields", async () => {
    const ndjsonPath = writeNdjson("basic.ndjson", [
      { email: "alice@example.com", totp_secret: "JBSWY3DPEHPK3PXP" },
      { email: "bob@example.com", totp_secret: "JBSWY3DPEHPK3PXQ" },
    ]);

    const mock = createMockWorkOS([
      { id: "user_alice", email: "alice@example.com" },
      { id: "user_bob", email: "bob@example.com" },
    ]);
    installMock(mock);

    const { summary } = await enrollTotpFactors({
      inputPath: ndjsonPath,
      format: "ndjson",
      quiet: true,
      concurrency: 1,
    });

    assert.equal(summary.total, 2);
    assert.equal(summary.enrolled, 2);
    restoreMock();
  });

  await test("NDJSON: extracts secret from mfa_factors array", async () => {
    const ndjsonPath = writeNdjson("mfa-factors.ndjson", [
      {
        email: "alice@example.com",
        mfa_factors: [{ type: "totp", secret: "JBSWY3DPEHPK3PXP" }],
      },
    ]);

    const mock = createMockWorkOS([
      { id: "user_alice", email: "alice@example.com" },
    ]);
    installMock(mock);

    const { summary } = await enrollTotpFactors({
      inputPath: ndjsonPath,
      format: "ndjson",
      quiet: true,
      concurrency: 1,
    });

    assert.equal(summary.total, 1);
    assert.equal(summary.enrolled, 1);
    assert.equal(mock.enrollCalls[0]!.totpSecret, "JBSWY3DPEHPK3PXP");
    restoreMock();
  });

  await test("NDJSON: uses 'secret' alias for totp_secret", async () => {
    const ndjsonPath = writeNdjson("secret-alias.ndjson", [
      { email: "alice@example.com", secret: "JBSWY3DPEHPK3PXP" },
    ]);

    const mock = createMockWorkOS([
      { id: "user_alice", email: "alice@example.com" },
    ]);
    installMock(mock);

    const { summary } = await enrollTotpFactors({
      inputPath: ndjsonPath,
      format: "ndjson",
      quiet: true,
      concurrency: 1,
    });

    assert.equal(summary.total, 1);
    assert.equal(summary.enrolled, 1);
    restoreMock();
  });

  await test("NDJSON: skips lines with missing email", async () => {
    const ndjsonPath = writeNdjson("missing-email.ndjson", [
      { totp_secret: "JBSWY3DPEHPK3PXP" },
      { email: "alice@example.com", totp_secret: "JBSWY3DPEHPK3PXQ" },
    ]);

    const mock = createMockWorkOS([
      { id: "user_alice", email: "alice@example.com" },
    ]);
    installMock(mock);

    const { summary } = await enrollTotpFactors({
      inputPath: ndjsonPath,
      format: "ndjson",
      quiet: true,
      concurrency: 1,
    });

    assert.equal(summary.total, 1);
    restoreMock();
  });

  // ------ User Lookup ------

  await test("User not found: records error and increments userNotFound", async () => {
    const csvPath = writeCsv("no-user.csv", [
      "email,totp_secret",
      "ghost@example.com,JBSWY3DPEHPK3PXP",
    ]);

    const mock = createMockWorkOS([]); // no users
    installMock(mock);

    const { summary, errors } = await enrollTotpFactors({
      inputPath: csvPath,
      format: "csv",
      quiet: true,
      concurrency: 1,
    });

    assert.equal(summary.total, 1);
    assert.equal(summary.userNotFound, 1);
    assert.equal(summary.failures, 1);
    assert.equal(summary.enrolled, 0);
    assert.equal(errors.length, 1);
    assert.equal(errors[0]!.errorType, "user_lookup");
    assert.ok(errors[0]!.errorMessage.includes("ghost@example.com"));
    restoreMock();
  });

  // ------ Enrollment ------

  await test("Successful enrollment: calls enrollAuthFactor with correct params", async () => {
    const csvPath = writeCsv("enroll-params.csv", [
      "email,totp_secret",
      "alice@example.com,JBSWY3DPEHPK3PXP",
    ]);

    const mock = createMockWorkOS([
      { id: "user_alice", email: "alice@example.com" },
    ]);
    installMock(mock);

    await enrollTotpFactors({
      inputPath: csvPath,
      format: "csv",
      quiet: true,
      concurrency: 1,
    });

    assert.equal(mock.enrollCalls.length, 1);
    assert.equal(mock.enrollCalls[0]!.userId, "user_alice");
    assert.equal(mock.enrollCalls[0]!.type, "totp");
    assert.equal(mock.enrollCalls[0]!.totpSecret, "JBSWY3DPEHPK3PXP");
    restoreMock();
  });

  await test("Enrollment: passes CLI-level totpIssuer option", async () => {
    const csvPath = writeCsv("issuer-option.csv", [
      "email,totp_secret",
      "alice@example.com,JBSWY3DPEHPK3PXP",
    ]);

    const mock = createMockWorkOS([
      { id: "user_alice", email: "alice@example.com" },
    ]);
    installMock(mock);

    await enrollTotpFactors({
      inputPath: csvPath,
      format: "csv",
      quiet: true,
      concurrency: 1,
      totpIssuer: "AcmeCorp",
    });

    assert.equal(mock.enrollCalls[0]!.totpIssuer, "AcmeCorp");
    restoreMock();
  });

  await test("Already enrolled: skips and counts as skipped", async () => {
    const csvPath = writeCsv("already-enrolled.csv", [
      "email,totp_secret",
      "alice@example.com,JBSWY3DPEHPK3PXP",
    ]);

    const mock = createMockWorkOS(
      [{ id: "user_alice", email: "alice@example.com" }],
      {
        enrollError: () => new Error("Factor already exists for this user"),
      }
    );
    installMock(mock);

    const { summary } = await enrollTotpFactors({
      inputPath: csvPath,
      format: "csv",
      quiet: true,
      concurrency: 1,
    });

    assert.equal(summary.skipped, 1);
    assert.equal(summary.failures, 0);
    assert.equal(summary.enrolled, 0);
    restoreMock();
  });

  await test("Enrollment failure: records error on non-duplicate failure", async () => {
    const csvPath = writeCsv("enroll-fail.csv", [
      "email,totp_secret",
      "alice@example.com,INVALID_SECRET",
    ]);

    const mock = createMockWorkOS(
      [{ id: "user_alice", email: "alice@example.com" }],
      {
        enrollError: () => {
          const err = new Error("Invalid TOTP secret format");
          Object.assign(err, { status: 422 });
          return err;
        },
      }
    );
    installMock(mock);

    const { summary, errors } = await enrollTotpFactors({
      inputPath: csvPath,
      format: "csv",
      quiet: true,
      concurrency: 1,
    });

    assert.equal(summary.failures, 1);
    assert.equal(summary.enrolled, 0);
    assert.equal(errors.length, 1);
    assert.equal(errors[0]!.errorType, "enroll_factor");
    assert.ok(errors[0]!.errorMessage.includes("Invalid TOTP secret"));
    restoreMock();
  });

  // ------ Dry Run ------

  await test("Dry run: looks up users but does not call enrollAuthFactor", async () => {
    const csvPath = writeCsv("dry-run.csv", [
      "email,totp_secret",
      "alice@example.com,JBSWY3DPEHPK3PXP",
      "bob@example.com,JBSWY3DPEHPK3PXQ",
    ]);

    const mock = createMockWorkOS([
      { id: "user_alice", email: "alice@example.com" },
      { id: "user_bob", email: "bob@example.com" },
    ]);
    installMock(mock);

    const { summary } = await enrollTotpFactors({
      inputPath: csvPath,
      format: "csv",
      quiet: true,
      concurrency: 1,
      dryRun: true,
    });

    assert.equal(summary.total, 2);
    assert.equal(summary.enrolled, 2);
    assert.equal(mock.enrollCalls.length, 0, "Should not call enrollAuthFactor in dry run");
    restoreMock();
  });

  // ------ Summary Counts ------

  await test("Summary: correct counts for mixed results", async () => {
    const csvPath = writeCsv("mixed.csv", [
      "email,totp_secret",
      "alice@example.com,JBSWY3DPEHPK3PXP",
      "ghost@example.com,JBSWY3DPEHPK3PXQ",
      "bob@example.com,JBSWY3DPEHPK3PXR",
      "charlie@example.com,JBSWY3DPEHPK3PXS",
    ]);

    const mock = createMockWorkOS(
      [
        { id: "user_alice", email: "alice@example.com" },
        { id: "user_bob", email: "bob@example.com" },
        { id: "user_charlie", email: "charlie@example.com" },
      ],
      {
        enrollError: (call) => {
          if (call.userId === "user_bob") {
            return new Error("Factor already enrolled for user");
          }
          if (call.userId === "user_charlie") {
            return new Error("Server error");
          }
          return null;
        },
      }
    );
    installMock(mock);

    const { summary } = await enrollTotpFactors({
      inputPath: csvPath,
      format: "csv",
      quiet: true,
      concurrency: 1,
    });

    assert.equal(summary.total, 4);
    assert.equal(summary.enrolled, 1, "Only alice should succeed");
    assert.equal(summary.skipped, 1, "Bob is already enrolled");
    assert.equal(summary.userNotFound, 1, "ghost has no user");
    assert.equal(summary.failures, 2, "ghost (userNotFound) + charlie (server error)");
    restoreMock();
  });

  // ------ Error Output File ------

  await test("Error output: writes errors to JSONL file", async () => {
    const csvPath = writeCsv("errors-out.csv", [
      "email,totp_secret",
      "ghost@example.com,JBSWY3DPEHPK3PXP",
    ]);
    const errorsPath = path.join(TEMP_DIR, "errors.jsonl");

    const mock = createMockWorkOS([]);
    installMock(mock);

    const { summary, errors } = await enrollTotpFactors({
      inputPath: csvPath,
      format: "csv",
      quiet: true,
      concurrency: 1,
      errorsOutPath: errorsPath,
    });

    assert.equal(summary.failures, 1);
    // When errorsOutPath is provided, errors go to file, not returned array
    assert.equal(errors.length, 0);

    // Verify the file was written
    assert.ok(fs.existsSync(errorsPath), "Errors file should exist");
    const lines = fs
      .readFileSync(errorsPath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean);
    assert.equal(lines.length, 1);
    const errorRecord = JSON.parse(lines[0]!);
    assert.equal(errorRecord.email, "ghost@example.com");
    assert.equal(errorRecord.errorType, "user_lookup");
    restoreMock();
  });

  // ------ Concurrency ------

  await test("Concurrency: processes multiple records with concurrency control", async () => {
    const rows = ["email,totp_secret"];
    const users: MockUser[] = [];
    for (let i = 0; i < 20; i++) {
      const email = `user${i}@example.com`;
      rows.push(`${email},SECRET${i.toString().padStart(3, "0")}`);
      users.push({ id: `user_${i}`, email });
    }
    const csvPath = writeCsv("concurrency.csv", rows);

    const mock = createMockWorkOS(users);
    installMock(mock);

    const { summary } = await enrollTotpFactors({
      inputPath: csvPath,
      format: "csv",
      quiet: true,
      concurrency: 5,
    });

    assert.equal(summary.total, 20);
    assert.equal(summary.enrolled, 20);
    assert.equal(mock.enrollCalls.length, 20);
    restoreMock();
  });

  // ------ Empty Input ------

  await test("Empty input: returns zero counts with no errors", async () => {
    const csvPath = writeCsv("empty.csv", ["email,totp_secret"]);

    const mock = createMockWorkOS([]);
    installMock(mock);

    const { summary, errors } = await enrollTotpFactors({
      inputPath: csvPath,
      format: "csv",
      quiet: true,
      concurrency: 1,
    });

    assert.equal(summary.total, 0);
    assert.equal(summary.enrolled, 0);
    assert.equal(summary.failures, 0);
    assert.equal(errors.length, 0);
    restoreMock();
  });

  // ------ Email Normalization ------

  await test("Email normalization: lowercases emails for matching", async () => {
    const csvPath = writeCsv("case.csv", [
      "email,totp_secret",
      "Alice@Example.COM,JBSWY3DPEHPK3PXP",
    ]);

    const mock = createMockWorkOS([
      { id: "user_alice", email: "alice@example.com" },
    ]);
    installMock(mock);

    const { summary } = await enrollTotpFactors({
      inputPath: csvPath,
      format: "csv",
      quiet: true,
      concurrency: 1,
    });

    assert.equal(summary.enrolled, 1);
    restoreMock();
  });

  // --- Cleanup ---
  console.log("\n→ Cleaning up temp files...");
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  console.log("  ✓ Cleanup complete");

  // --- Summary ---
  console.log("\n===================");
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
    console.log("✓ All TOTP enroller tests passed!");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
