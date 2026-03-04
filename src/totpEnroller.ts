import fs from "node:fs";
import { parse } from "csv-parse";
import { createInterface } from "node:readline";
import { getWorkOSClient } from "./workos.js";
import { createLogger } from "./logger.js";
import { RateLimiter } from "./rateLimiter.js";

export interface TotpCsvRow {
  email: string;
  totp_secret: string;
  totp_issuer?: string;
  totp_user?: string;
}

interface TotpNdjsonRecord {
  email: string;
  totp_secret?: string;
  secret?: string;
  mfa_factors?: Array<{
    type: string;
    secret?: string;
    totp_secret?: string;
  }>;
}

export interface TotpEnrollOptions {
  inputPath: string;
  format: "csv" | "ndjson";
  quiet?: boolean;
  concurrency?: number;
  dryRun?: boolean;
  errorsOutPath?: string;
  totpIssuer?: string;
}

export interface TotpErrorRecord {
  recordNumber: number;
  email: string;
  errorType: "user_lookup" | "enroll_factor" | "parse";
  errorMessage: string;
  timestamp: string;
  httpStatus?: number;
}

export interface TotpEnrollSummary {
  total: number;
  enrolled: number;
  skipped: number;
  failures: number;
  userNotFound: number;
  startedAt: number;
  endedAt: number;
  warnings: string[];
}

class Semaphore {
  private max: number;
  private count: number;
  private queue: Array<() => void>;
  constructor(max: number) {
    this.max = Math.max(1, max);
    this.count = 0;
    this.queue = [];
  }
  async acquire(): Promise<void> {
    if (this.count < this.max) {
      this.count += 1;
      return;
    }
    await new Promise<void>(resolve => {
      this.queue.push(() => {
        this.count += 1;
        resolve();
      });
    });
  }
  release(): void {
    this.count -= 1;
    const next = this.queue.shift();
    if (next) next();
  }
}

async function retryEnrollAuthFactor(
  userId: string,
  totpSecret: string,
  limiter: RateLimiter,
  totpIssuer?: string,
  totpUser?: string,
  maxRetries = 3,
  baseDelayMs = 500
): Promise<void> {
  const workos = getWorkOSClient();
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await limiter.acquire();
      await workos.userManagement.enrollAuthFactor({
        userId,
        type: "totp",
        totpSecret,
        ...(totpIssuer ? { totpIssuer } : {}),
        ...(totpUser ? { totpUser } : {}),
      });
      return;
    } catch (err: unknown) {
      const error = err as Record<string, unknown>;
      const status: number | undefined =
        (error?.status as number) ?? (error?.httpStatus as number) ?? (error?.response as Record<string, unknown>)?.status as number | undefined;
      const message: string = (error?.message as string) || "Unknown error";
      const isRateLimited = status === 429 || /rate.?limit/i.test(message);
      attempt += 1;
      if (isRateLimited && attempt <= maxRetries) {
        const responseHeaders = (error?.response as Record<string, unknown>)?.headers as Record<string, string> | undefined;
        const retryAfter = responseHeaders?.['retry-after'] ?? responseHeaders?.['Retry-After'];
        let delay = baseDelayMs * Math.pow(2, attempt - 1);
        if (retryAfter) {
          const retryAfterSeconds = parseInt(retryAfter, 10);
          if (!isNaN(retryAfterSeconds)) {
            delay = retryAfterSeconds * 1000;
          }
        }
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
}

async function lookupUserByEmail(
  email: string,
  limiter: RateLimiter
): Promise<string | null> {
  const workos = getWorkOSClient();
  await limiter.acquire();
  const users = await workos.userManagement.listUsers({ email });
  const data = users.data;
  if (data.length === 0) return null;
  const first = data[0];
  if (!first) return null;
  return first.id;
}

async function loadTotpRecordsFromCsv(
  filePath: string
): Promise<TotpCsvRow[]> {
  return new Promise((resolve, reject) => {
    const records: TotpCsvRow[] = [];
    const input = fs.createReadStream(filePath);
    const parser = parse({
      columns: true,
      bom: true,
      skip_empty_lines: true,
      trim: true,
    });

    parser.on("data", (row: Record<string, string>) => {
      if (row.email && row.totp_secret) {
        records.push({
          email: row.email.toLowerCase().trim(),
          totp_secret: row.totp_secret.trim(),
          totp_issuer: row.totp_issuer?.trim() || undefined,
          totp_user: row.totp_user?.trim() || undefined,
        });
      }
    });
    parser.on("end", () => resolve(records));
    parser.on("error", reject);
    input.pipe(parser);
  });
}

async function loadTotpRecordsFromNdjson(
  filePath: string
): Promise<TotpCsvRow[]> {
  const records: TotpCsvRow[] = [];
  const fileStream = fs.createReadStream(filePath, { encoding: "utf-8" });
  const rl = createInterface({ input: fileStream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const record: TotpNdjsonRecord = JSON.parse(line);
      if (!record.email) continue;

      // Try direct totp_secret/secret field first
      let secret = record.totp_secret || record.secret;

      // Fall back to mfa_factors array
      if (!secret && record.mfa_factors) {
        const totpFactor = record.mfa_factors.find(f => f.type === "totp");
        secret = totpFactor?.secret || totpFactor?.totp_secret;
      }

      if (secret) {
        records.push({
          email: record.email.toLowerCase().trim(),
          totp_secret: secret.trim(),
        });
      }
    } catch {
      // Skip invalid JSON lines
    }
  }

  return records;
}

export async function enrollTotpFactors(options: TotpEnrollOptions): Promise<{
  summary: TotpEnrollSummary;
  errors: TotpErrorRecord[];
}> {
  const {
    inputPath,
    format,
    quiet,
    concurrency = 10,
    dryRun = false,
    errorsOutPath,
    totpIssuer,
  } = options;

  const logger = createLogger({ quiet });
  const limiter = new RateLimiter(50);
  const startedAt = Date.now();
  const errors: TotpErrorRecord[] = [];
  const warnings: string[] = [];

  let errorStream: fs.WriteStream | null = null;
  if (errorsOutPath) {
    errorStream = fs.createWriteStream(errorsOutPath, { flags: "w", encoding: "utf8" });
  }

  const recordError = (errRec: TotpErrorRecord) => {
    if (errorStream) {
      errorStream.write(JSON.stringify(errRec) + "\n");
    } else {
      errors.push(errRec);
    }
  };

  const summary: TotpEnrollSummary = {
    total: 0,
    enrolled: 0,
    skipped: 0,
    failures: 0,
    userNotFound: 0,
    startedAt,
    endedAt: startedAt,
    warnings,
  };

  // Load records
  logger.log(`Loading TOTP secrets from ${format.toUpperCase()} file...`);
  const records =
    format === "ndjson"
      ? await loadTotpRecordsFromNdjson(inputPath)
      : await loadTotpRecordsFromCsv(inputPath);

  summary.total = records.length;
  logger.log(`Loaded ${records.length} TOTP records\n`);

  if (records.length === 0) {
    summary.endedAt = Date.now();
    limiter.stop();
    return { summary, errors };
  }

  if (dryRun) {
    logger.log("[DRY RUN] No changes will be made\n");
  }

  // Process with concurrency control
  const semaphore = new Semaphore(concurrency);
  const inFlight: Promise<void>[] = [];

  for (const [i, record] of records.entries()) {
    const recordNumber = i + 1;

    const task = (async () => {
      await semaphore.acquire();
      try {
        // Look up user by email
        let userId: string | null = null;
        try {
          userId = await lookupUserByEmail(record.email, limiter);
        } catch (err: unknown) {
          const error = err as Record<string, unknown>;
          recordError({
            recordNumber,
            email: record.email,
            errorType: "user_lookup",
            errorMessage: (error?.message as string) || "User lookup failed",
            timestamp: new Date().toISOString(),
            httpStatus: (error?.status as number) ?? undefined,
          });
          summary.failures += 1;
          logger.stepFailure(recordNumber);
          return;
        }

        if (!userId) {
          recordError({
            recordNumber,
            email: record.email,
            errorType: "user_lookup",
            errorMessage: `No WorkOS user found for email: ${record.email}`,
            timestamp: new Date().toISOString(),
          });
          summary.userNotFound += 1;
          summary.failures += 1;
          logger.stepFailure(recordNumber);
          return;
        }

        if (dryRun) {
          logger.log(`  [DRY RUN] Would enroll TOTP for ${record.email} (user: ${userId})`);
          summary.enrolled += 1;
          return;
        }

        // Enroll TOTP factor
        try {
          await retryEnrollAuthFactor(
            userId,
            record.totp_secret,
            limiter,
            totpIssuer || record.totp_issuer,
            record.totp_user || record.email,
          );
          summary.enrolled += 1;
          logger.stepSuccess(recordNumber);
        } catch (err: unknown) {
          const error = err as Record<string, unknown>;
          const message = (error?.message as string) || "Unknown error";

          // If factor already exists, count as skipped not failed
          if (/already.?enrolled|factor.?already.?exists|duplicate/i.test(message)) {
            summary.skipped += 1;
            logger.log(`  Skipped ${record.email}: TOTP factor already enrolled`);
            return;
          }

          recordError({
            recordNumber,
            email: record.email,
            errorType: "enroll_factor",
            errorMessage: message,
            timestamp: new Date().toISOString(),
            httpStatus: (error?.status as number) ?? undefined,
          });
          summary.failures += 1;
          logger.stepFailure(recordNumber);
        }
      } finally {
        semaphore.release();
      }
    })();

    inFlight.push(task);

    // Drain in batches to avoid unbounded memory
    if (inFlight.length >= concurrency * 10) {
      await Promise.all(inFlight);
      inFlight.length = 0;
    }
  }

  // Wait for remaining tasks
  await Promise.all(inFlight);

  summary.endedAt = Date.now();
  limiter.stop();

  if (errorStream) {
    errorStream.end();
  }

  return { summary, errors };
}
