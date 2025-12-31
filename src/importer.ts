import fs from "node:fs";
import { parse } from "csv-parse";
import { getWorkOSClient } from "./workos.js";
import { createLogger } from "./logger.js";
import { isBlank, parseBooleanLike } from "./boolean.js";
import { CreateUserPayload, CSVRow, ErrorRecord, ImportSummary } from "./types.js";
import { RateLimiter } from "./rateLimiter.js";
import { OrganizationCache } from "./cache/organizationCache.js";

type ImportOptions = {
  csvPath: string;
  quiet?: boolean;
  concurrency?: number;
  orgId?: string | null;
  requireMembership?: boolean;
  dryRun?: boolean;
  errorsOutPath?: string;
  multiOrgMode?: boolean; // NEW: Enables per-row org resolution with caching
};

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

const KNOWN_COLUMNS = new Set([
  "email",
  "password",
  "password_hash",
  "password_hash_type",
  "first_name",
  "last_name",
  "email_verified",
  "external_id",
  "metadata",
  // Organization columns (multi-org mode)
  "org_id",
  "org_external_id",
  "org_name"
]);

interface OrgInfo {
  orgId?: string;
  orgExternalId?: string;
  orgName?: string;
}

function buildUserAndOrgFromRow(row: CSVRow): {
  userPayload?: CreateUserPayload;
  orgInfo?: OrgInfo;
  error?: string;
} {
  // Extract and validate email
  const email = typeof row.email === "string" ? row.email.trim() : "";
  if (!email) {
    return { error: "Missing required email" };
  }

  // Extract user fields (existing logic)
  const password = typeof row.password === "string" ? row.password : undefined;
  const passwordHash = typeof row.password_hash === "string" ? row.password_hash : undefined;
  const passwordHashType = typeof row.password_hash_type === "string" ? row.password_hash_type : undefined;
  const firstName = typeof row.first_name === "string" ? row.first_name : undefined;
  const lastName = typeof row.last_name === "string" ? row.last_name : undefined;
  const emailVerifiedParsed = parseBooleanLike(row.email_verified);
  const externalId = typeof row.external_id === "string" ? row.external_id : undefined;

  let metadata: Record<string, unknown> | undefined;
  if (typeof row.metadata === "string") {
    const trimmed = row.metadata.trim();
    if (trimmed.length > 0) {
      try {
        metadata = JSON.parse(trimmed);
      } catch {
        return { error: "Invalid metadata JSON" };
      }
    }
  }

  // Extract organization fields
  const orgId = typeof row.org_id === "string" && row.org_id.trim() !== ""
    ? row.org_id.trim()
    : undefined;
  const orgExternalId = typeof row.org_external_id === "string" && row.org_external_id.trim() !== ""
    ? row.org_external_id.trim()
    : undefined;
  const orgName = typeof row.org_name === "string" && row.org_name.trim() !== ""
    ? row.org_name.trim()
    : undefined;

  // Validation: cannot have both org_id and org_external_id
  if (orgId && orgExternalId) {
    return { error: "Row cannot specify both org_id and org_external_id" };
  }

  // Build user payload
  const payload: CreateUserPayload = {
    email
  };

  // Prefer hash over plaintext password when both are present
  if (!isBlank(passwordHash) && !isBlank(passwordHashType)) {
    payload.passwordHash = passwordHash;
    payload.passwordHashType = passwordHashType;
  } else if (!isBlank(password)) {
    payload.password = password;
  }

  if (!isBlank(firstName)) payload.firstName = firstName;
  if (!isBlank(lastName)) payload.lastName = lastName;
  if (emailVerifiedParsed !== undefined) payload.emailVerified = emailVerifiedParsed;
  if (!isBlank(externalId)) payload.externalId = externalId;
  if (metadata !== undefined) payload.metadata = metadata;

  // Build org info (only if at least one org field is present)
  const orgInfo = (orgId || orgExternalId || orgName) ? {
    orgId,
    orgExternalId,
    orgName
  } : undefined;

  return { userPayload: payload, orgInfo };
}

async function retryCreateUser(
  payload: CreateUserPayload,
  limiter: RateLimiter,
  maxRetries = 3,
  baseDelayMs = 500
): Promise<string> {
  const workos = getWorkOSClient();
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await limiter.acquire();
      const user = await workos.userManagement.createUser(payload as any);
      return (user as any)?.id as string;
    } catch (err: any) {
      const status: number | undefined =
        err?.status ?? err?.httpStatus ?? err?.code ?? err?.response?.status;
      const message: string = err?.message || "Unknown error";
      const isRateLimited = status === 429 || /rate.?limit/i.test(message);
      attempt += 1;
      if (isRateLimited && attempt <= maxRetries) {
        let delay = baseDelayMs * Math.pow(2, attempt - 1);

        // Respect Retry-After header if provided
        const retryAfter = err?.response?.headers?.['retry-after'] ?? err?.response?.headers?.['Retry-After'];
        if (retryAfter) {
          const retryAfterSeconds = parseInt(retryAfter, 10);
          if (!isNaN(retryAfterSeconds)) {
            delay = retryAfterSeconds * 1000; // Convert seconds to milliseconds
          }
        }

        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
}

async function retryCreateOrganizationMembership(
  userId: string,
  organizationId: string,
  limiter: RateLimiter,
  maxRetries = 3,
  baseDelayMs = 500
): Promise<void> {
  const workos = getWorkOSClient();
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await limiter.acquire();
      await workos.userManagement.createOrganizationMembership({
        userId,
        organizationId
      } as any);
      return;
    } catch (err: any) {
      const status: number | undefined =
        err?.status ?? err?.httpStatus ?? err?.response?.status;
      const message: string = err?.message || "Unknown error";
      const isRateLimited = status === 429 || /rate.?limit/i.test(message);
      attempt += 1;
      if (isRateLimited && attempt <= maxRetries) {
        let delay = baseDelayMs * Math.pow(2, attempt - 1);

        // Respect Retry-After header if provided
        const retryAfter = err?.response?.headers?.['retry-after'] ?? err?.response?.headers?.['Retry-After'];
        if (retryAfter) {
          const retryAfterSeconds = parseInt(retryAfter, 10);
          if (!isNaN(retryAfterSeconds)) {
            delay = retryAfterSeconds * 1000; // Convert seconds to milliseconds
          }
        }

        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
}

async function deleteUserSafe(userId: string): Promise<void> {
  const workos = getWorkOSClient();
  try {
    await (workos.userManagement as any).deleteUser(userId);
  } catch {
    // Best-effort delete; ignore errors
  }
}

export async function importUsersFromCsv(options: ImportOptions): Promise<{
  summary: ImportSummary;
  errors: ErrorRecord[];
}> {
  const { csvPath, quiet, concurrency = 10, orgId = null, requireMembership = false, dryRun = false, errorsOutPath, multiOrgMode = false } = options;
  const logger = createLogger({ quiet });
  const limiter = new RateLimiter(50);
  const startedAt = Date.now();
  const errors: ErrorRecord[] = [];
  const warnings: string[] = [];

  // Initialize organization cache for multi-org mode
  let orgCache: OrganizationCache | null = null;
  if (!orgId && multiOrgMode) {
    orgCache = new OrganizationCache({ maxSize: 10000 });
    logger.log("Multi-org mode: Organization cache initialized");
  }

  // Set up error streaming if output path provided
  let errorStream: fs.WriteStream | null = null;
  let errorCount = 0;
  if (errorsOutPath) {
    errorStream = fs.createWriteStream(errorsOutPath, { flags: 'w', encoding: 'utf8' });
  }

  // Helper to record errors - streams to file if available, else accumulates in memory
  const recordError = (errRec: ErrorRecord) => {
    errorCount += 1;
    if (errorStream) {
      errorStream.write(JSON.stringify(errRec) + '\n');
    } else {
      errors.push(errRec);
    }
  };

  const summary: ImportSummary = {
    total: 0,
    successes: 0,
    failures: 0,
    membershipsCreated: 0,
    startedAt,
    endedAt: startedAt,
    warnings
  };

  const input = fs.createReadStream(csvPath);
  let headerHandled = false;
  let warnedUnknown = false;
  let recordNumber = 0;

  const semaphore = new Semaphore(concurrency);
  const inFlight: Promise<void>[] = [];
  const MAX_INFLIGHT_BATCH = concurrency * 10; // Process in batches of 10x concurrency

  await new Promise<void>((resolve, reject) => {
    const parser = parse({
      columns: true,
      bom: true,
      skip_empty_lines: true,
      trim: true
    });

    parser.on("error", (err) => reject(err));
    parser.on("end", () => resolve());

    parser.on("readable", async () => {
      let row: CSVRow | null;
      // eslint-disable-next-line no-cond-assign
      while ((row = parser.read()) !== null) {
        // If we've reached batch limit, wait for current batch to complete
        if (inFlight.length >= MAX_INFLIGHT_BATCH) {
          await Promise.allSettled(inFlight);
          inFlight.length = 0; // Clear completed batch
        }

        const rowData = row as CSVRow; // capture per-iteration to avoid closure over mutable 'row'
        if (!headerHandled) {
          headerHandled = true;
          const headers = Object.keys(rowData as Record<string, unknown>);
          if (!headers.includes("email")) {
            reject(new Error("CSV must include required 'email' column."));
            return;
          }

          // Detect organization columns and validate mode
          const hasOrgColumns = headers.some(h =>
            h === "org_id" || h === "org_external_id" || h === "org_name"
          );

          if (hasOrgColumns && orgId) {
            // Both CLI flags and CSV org columns present
            warnings.push(
              "Warning: CSV contains org columns but CLI flags provided. " +
              "Using single-org mode (CLI flags take precedence). " +
              "Org columns will be ignored."
            );
          } else if (hasOrgColumns && !orgId) {
            // Confirm multi-org mode
            logger.log("Detected org columns in CSV: multi-org mode confirmed");
          } else if (!hasOrgColumns && !orgId) {
            // User-only mode
            logger.log("No org columns or CLI flags detected: User-only mode");
          }

          const unknown = headers.filter(h => !KNOWN_COLUMNS.has(h));
          if (unknown.length > 0 && !warnedUnknown) {
            warnings.push(`Ignoring unknown columns: ${unknown.join(", ")}`);
            warnedUnknown = true;
          }
        }
        recordNumber += 1;
        const currentRecord = recordNumber;
        summary.total += 1;
        const email = typeof rowData.email === "string" ? rowData.email : undefined;

        // Queue task with concurrency control
        const task = (async () => {
          logger.stepStart(currentRecord);
          const built = buildUserAndOrgFromRow(rowData);
          if (built.error) {
            const errRec: ErrorRecord = {
              recordNumber: currentRecord,
              email,
              errorType: "user_create",
              errorMessage: built.error,
              timestamp: new Date().toISOString(),
              rawRow: rowData as Record<string, unknown>
            };
            recordError(errRec);
            summary.failures += 1;
            logger.stepFailure(currentRecord);
            return;
          }

          // Resolve organization per-row (multi-org mode)
          let resolvedOrgId: string | null = orgId; // Use CLI org in single-org mode

          if (!orgId && built.orgInfo && orgCache) {
            // Multi-org mode: resolve org from row
            try {
              resolvedOrgId = await orgCache.resolve({
                orgId: built.orgInfo.orgId,
                orgExternalId: built.orgInfo.orgExternalId,
                createIfMissing: Boolean(built.orgInfo.orgName),
                orgName: built.orgInfo.orgName
              });

              if (!resolvedOrgId && (built.orgInfo.orgId || built.orgInfo.orgExternalId)) {
                // Org specified but not found and no org_name for creation
                throw new Error(
                  `Organization not found: ${built.orgInfo.orgId || built.orgInfo.orgExternalId}`
                );
              }
            } catch (err: any) {
              // org_resolution error
              const errRec: ErrorRecord = {
                recordNumber: currentRecord,
                email,
                errorType: "org_resolution",
                errorMessage: err?.message || "Organization resolution failed",
                timestamp: new Date().toISOString(),
                rawRow: rowData as Record<string, unknown>,
                orgId: built.orgInfo.orgId,
                orgExternalId: built.orgInfo.orgExternalId,
                httpStatus: err?.status ?? err?.httpStatus ?? err?.response?.status
              };
              recordError(errRec);
              summary.failures += 1;
              logger.stepFailure(currentRecord);
              logger.warn(`Record #${currentRecord} org resolution failed: ${err?.message}`);
              return;
            }
          }

          let createdUserId: string | undefined;
          try {
            if (!dryRun) {
              createdUserId = await retryCreateUser(built.userPayload!, limiter);
            } else {
              // Simulate user creation
              createdUserId = undefined;
            }
            // Create membership if org is specified (single-org or multi-org mode)
            if (resolvedOrgId) {
              try {
                if (!dryRun) {
                  await retryCreateOrganizationMembership(createdUserId!, resolvedOrgId, limiter);
                }
                summary.membershipsCreated += 1;
              } catch (err) {
                if (requireMembership) {
                    if (!dryRun && createdUserId) {
                      await deleteUserSafe(createdUserId);
                    }
                }
                const status: number | undefined =
                  (err as any)?.status ?? (err as any)?.httpStatus ?? (err as any)?.response?.status ?? (err as any)?.code;
                const workosCode: string | undefined =
                  (err as any)?.response?.data?.code ?? (err as any)?.code;
                const requestId: string | undefined =
                  (err as any)?.requestId ?? (err as any)?.response?.headers?.["x-request-id"] ?? (err as any)?.response?.headers?.["X-Request-Id"];
                const workosErrors = (err as any)?.response?.data?.errors ?? (err as any)?.errors;
                const message: string = (err as any)?.message || "Unknown error";
                const errRec: ErrorRecord = {
                  recordNumber: currentRecord,
                  email,
                  userId: createdUserId,
                  errorType: "membership_create",
                  errorMessage: message,
                  timestamp: new Date().toISOString(),
                  rawRow: rowData as Record<string, unknown>,
                  httpStatus: status,
                  workosCode,
                  workosRequestId: requestId,
                  workosErrors
                };
                recordError(errRec);
                summary.failures += 1;
                logger.stepFailure(currentRecord);
                const statusStr = status != null ? String(status) : "?";
                const codeStr = workosCode ?? "?";
                const reqStr = requestId ?? "?";
                logger.warn(`Record #${currentRecord} membership failed: status=${statusStr} code=${codeStr} requestId=${reqStr} message=${message}`);
                return;
              }
            }
            summary.successes += 1;
            logger.stepSuccess(currentRecord);
          } catch (err: any) {
            if (dryRun) {
              // Should not reach here in dry run; treat as logic error
              const errRec: ErrorRecord = {
                recordNumber: currentRecord,
                email,
                errorType: "user_create",
                errorMessage: err?.message || "Dry run error",
                timestamp: new Date().toISOString(),
                rawRow: rowData as Record<string, unknown>
              };
              recordError(errRec);
              summary.failures += 1;
              logger.stepFailure(currentRecord);
              return;
            }
            const status: number | undefined =
              err?.status ?? err?.httpStatus ?? err?.response?.status ?? err?.code;
            const workosCode: string | undefined =
              err?.response?.data?.code ?? err?.code;
            const requestId: string | undefined =
              err?.requestId ?? err?.response?.headers?.["x-request-id"] ?? err?.response?.headers?.["X-Request-Id"];
            const workosErrors = err?.response?.data?.errors ?? err?.errors;
            const message: string = err?.message || "Unknown error";
            const errRec: ErrorRecord = {
              recordNumber: currentRecord,
              email,
              userId: createdUserId,
              errorType: "user_create",
              errorMessage: message,
              timestamp: new Date().toISOString(),
              rawRow: rowData as Record<string, unknown>,
              httpStatus: status,
              workosCode,
              workosRequestId: requestId,
              workosErrors
            };
            recordError(errRec);
            summary.failures += 1;
            logger.stepFailure(currentRecord);
            const statusStr = status != null ? String(status) : "?";
            const codeStr = workosCode ?? "?";
            const reqStr = requestId ?? "?";
            // Print additional non-PII failure context
            logger.warn(`Record #${currentRecord} failed: status=${statusStr} code=${codeStr} requestId=${reqStr} message=${message}`);
          }
        })();

        // Acquire/release around task to enforce concurrency and backpressure
        const run = (async () => {
          await semaphore.acquire();
          try {
            await task;
          } finally {
            semaphore.release();
          }
        })();
        inFlight.push(run);
      }
    });

    input.pipe(parser);
  });

  // Wait for all in-flight tasks
  await Promise.all(inFlight);
  summary.endedAt = Date.now();

  // Clean up rate limiter
  limiter.stop();

  // Collect cache statistics (multi-org mode)
  if (orgCache) {
    const cacheStats = orgCache.getStats();
    summary.cacheStats = {
      hits: cacheStats.hits,
      misses: cacheStats.misses,
      hitRate: `${(cacheStats.hitRate * 100).toFixed(1)}%`
    };
  }

  // Close error stream if opened
  if (errorStream) {
    await new Promise<void>((resolve, reject) => {
      errorStream!.end((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  return { summary, errors };
}

