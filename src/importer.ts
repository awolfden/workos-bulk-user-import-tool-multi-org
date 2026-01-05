import fs from "node:fs";
import { parse } from "csv-parse";
import { getWorkOSClient } from "./workos.js";
import { createLogger } from "./logger.js";
import { isBlank, parseBooleanLike } from "./boolean.js";
import { CreateUserPayload, CSVRow, ErrorRecord, ImportSummary } from "./types.js";
import { RateLimiter } from "./rateLimiter.js";
import { OrganizationCache } from "./cache/organizationCache.js";
import { CheckpointManager } from "./checkpoint/manager.js";
import type { ChunkMetadata } from "./types.js";

type ImportOptions = {
  csvPath: string;
  quiet?: boolean;
  concurrency?: number;
  orgId?: string | null;
  requireMembership?: boolean;
  dryRun?: boolean;
  errorsOutPath?: string;
  multiOrgMode?: boolean; // Enables per-row org resolution with caching
  checkpointManager?: CheckpointManager; // Phase 3: Enables chunked mode with checkpoints
  numWorkers?: number; // Phase 4: Number of worker threads for parallel processing
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
  // Phase 4: Route to worker pool mode if multiple workers specified
  if (options.checkpointManager && options.numWorkers && options.numWorkers > 1) {
    return importUsersWorkerMode(options);
  }

  // Phase 3: Route to chunked mode if checkpoint manager provided
  if (options.checkpointManager) {
    return importUsersChunkedMode(options);
  }

  // Original streaming mode (backward compatible)
  return importUsersStreamingMode(options);
}

/**
 * Phase 3: Streaming mode (original behavior, backward compatible)
 * Processes entire CSV in one pass without checkpointing
 */
async function importUsersStreamingMode(options: ImportOptions): Promise<{
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
    orgCache = new OrganizationCache({ maxSize: 10000, dryRun });
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
    usersCreated: 0,
    duplicateUsers: 0,
    duplicateMemberships: 0,
    startedAt,
    endedAt: startedAt,
    warnings
  };

  // Track created users and memberships to support multi-org CSV (multiple rows per user)
  const createdUsers = new Map<string, string>(); // email → userId
  const createdMemberships = new Set<string>(); // "userId:orgId"

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
          const userEmail = built.userPayload!.email.toLowerCase();

          // Check if user was already created in previous row (multi-org mode)
          if (createdUsers.has(userEmail)) {
            // User already created - reuse existing userId
            createdUserId = createdUsers.get(userEmail)!;
            summary.duplicateUsers += 1;

            // Warn if user data conflicts with first occurrence
            const firstPayload = built.userPayload!;
            if (firstPayload.firstName || firstPayload.lastName) {
              logger.warn(`Row ${currentRecord}: Duplicate user ${userEmail} - using existing user, ignoring new user data`);
            }
          } else {
            // First occurrence - create user
            try {
              if (!dryRun) {
                createdUserId = await retryCreateUser(built.userPayload!, limiter);
              } else {
                // Simulate user creation
                createdUserId = `dry-run-user-${userEmail}`;
              }
              createdUsers.set(userEmail, createdUserId!);
              summary.usersCreated += 1;
            } catch (err: any) {
              // Handle user creation errors
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
              return;
            }
          }

          // Create membership if org is specified (single-org or multi-org mode)
          if (resolvedOrgId && createdUserId) {
            const membershipKey = `${createdUserId}:${resolvedOrgId}`;

            // Check if membership already created
            if (createdMemberships.has(membershipKey)) {
              summary.duplicateMemberships += 1;
              logger.warn(`Row ${currentRecord}: Membership already exists for ${userEmail} in org ${resolvedOrgId} - skipping`);
            } else {
              try {
                if (!dryRun) {
                  await retryCreateOrganizationMembership(createdUserId!, resolvedOrgId, limiter);
                }
                createdMemberships.add(membershipKey);
                summary.membershipsCreated += 1;
              } catch (err) {
                const status: number | undefined =
                  (err as any)?.status ?? (err as any)?.httpStatus ?? (err as any)?.response?.status ?? (err as any)?.code;
                const workosCode: string | undefined =
                  (err as any)?.response?.data?.code ?? (err as any)?.code;

                // Handle 409 conflict (duplicate membership) gracefully
                if (status === 409) {
                  summary.duplicateMemberships += 1;
                  createdMemberships.add(membershipKey);
                  logger.warn(`Row ${currentRecord}: Membership already exists (409) for ${userEmail} in org ${resolvedOrgId} - continuing`);
                } else {
                  // Other errors - fail the row
                  if (requireMembership) {
                    if (!dryRun && createdUserId) {
                      await deleteUserSafe(createdUserId);
                    }
                  }
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
            }
          }
          summary.successes += 1;
          logger.stepSuccess(currentRecord);
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
      errorStream!.end((err?: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  return { summary, errors };
}

/**
 * Phase 3: Chunked mode with checkpointing
 * Processes CSV in chunks, saving state after each chunk for resumability
 */
async function importUsersChunkedMode(options: ImportOptions): Promise<{
  summary: ImportSummary;
  errors: ErrorRecord[];
}> {
  const { checkpointManager, quiet, dryRun } = options;
  if (!checkpointManager) {
    throw new Error("Checkpoint manager required for chunked mode");
  }

  const logger = createLogger({ quiet });
  const state = checkpointManager.getState();

  // Restore organization cache from checkpoint if available
  let orgCache: OrganizationCache | null = null;
  if (state.mode === 'multi-org') {
    orgCache = checkpointManager.restoreCache(dryRun);
    if (orgCache) {
      const stats = orgCache.getStats();
      logger.log(`Restored organization cache: ${stats.size} entries`);
    } else {
      orgCache = new OrganizationCache({ maxSize: 10000, dryRun });
      logger.log("Multi-org mode: Organization cache initialized");
    }
  }

  // Process chunks sequentially
  while (true) {
    const chunk = checkpointManager.getNextPendingChunk();
    if (!chunk) {
      break; // All chunks completed
    }

    logger.log(`Processing chunk ${chunk.chunkId + 1}/${state.chunks.length} (rows ${chunk.startRow}-${chunk.endRow})`);

    checkpointManager.markChunkStarted(chunk.chunkId);

    try {
      const chunkSummary = await processChunk(chunk, options, orgCache);
      checkpointManager.markChunkCompleted(chunk.chunkId, chunkSummary);
    } catch (err: any) {
      checkpointManager.markChunkFailed(chunk.chunkId);
      logger.error(`Chunk ${chunk.chunkId} failed: ${err.message}`);
      throw err;
    }

    // Serialize cache to checkpoint
    if (orgCache) {
      checkpointManager.serializeCache(orgCache);
    }

    // Save checkpoint
    await checkpointManager.saveCheckpoint();

    // Report progress
    const progress = checkpointManager.getProgress();
    const eta = progress.estimatedTimeRemainingMs
      ? formatDuration(progress.estimatedTimeRemainingMs)
      : "calculating...";
    logger.log(`Progress: ${progress.completedChunks}/${progress.totalChunks} chunks (${progress.percentComplete}%) - ETA: ${eta}`);
  }

  // Return final summary
  const summary = checkpointManager.getFinalSummary();
  return { summary, errors: [] }; // Errors streamed to checkpoint dir
}

/**
 * Phase 3: Process a single chunk
 * Re-parses CSV from start, skips to chunk start, processes chunk rows
 */
async function processChunk(
  chunk: ChunkMetadata,
  options: ImportOptions,
  orgCache: OrganizationCache | null
): Promise<import("./types.js").ChunkSummary> {
  const { csvPath, concurrency = 10, orgId = null, requireMembership = false, dryRun = false, checkpointManager } = options;
  const logger = createLogger({ quiet: true }); // Quiet for individual rows
  const limiter = new RateLimiter(50);
  const sem = new Semaphore(concurrency);

  const chunkStartTime = Date.now();
  let chunkSuccesses = 0;
  let chunkFailures = 0;
  let chunkMemberships = 0;
  let chunkUsersCreated = 0;
  let chunkDuplicateUsers = 0;
  let chunkDuplicateMemberships = 0;

  // Track users and memberships within this chunk (for multi-org CSV support)
  const createdUsers = new Map<string, string>(); // email → userId
  const createdMemberships = new Set<string>(); // "userId:orgId"

  // Set up error streaming to checkpoint dir
  let errorStream: fs.WriteStream | null = null;
  if (checkpointManager) {
    const errorPath = `${checkpointManager.getCheckpointDir()}/errors.jsonl`;
    errorStream = fs.createWriteStream(errorPath, { flags: 'a', encoding: 'utf8' });
  }

  const recordError = (errRec: ErrorRecord) => {
    if (errorStream) {
      errorStream.write(JSON.stringify(errRec) + '\n');
    }
  };

  // Re-open CSV and parse
  const input = fs.createReadStream(csvPath);
  const parser = parse({
    columns: true,
    bom: true,
    skip_empty_lines: true,
    trim: true
  });

  let recordNumber = 0;
  const inFlight: Promise<void>[] = [];

  await new Promise<void>((resolve, reject) => {
    parser.on("readable", async () => {
      let row: CSVRow | null;
      while ((row = parser.read()) !== null) {
        recordNumber++;

        // Skip rows before chunk start or after chunk end
        if (recordNumber < chunk.startRow || recordNumber > chunk.endRow) {
          continue;
        }

        // Capture row value for closure
        const currentRow = row;
        const currentRecordNumber = recordNumber;

        // Process row (same logic as streaming mode)
        const run = (async () => {
          await sem.acquire();
          try {
            const built = buildUserAndOrgFromRow(currentRow);

            if (built.error) {
              chunkFailures += 1;
              recordError({
                recordNumber: currentRecordNumber,
                email: String(currentRow.email ?? ""),
                errorType: "user_create",
                errorMessage: built.error,
                timestamp: new Date().toISOString(),
                rawRow: currentRow
              });
              return;
            }

            if (!built.userPayload) {
              return;
            }

            const payload = built.userPayload;

            // Resolve org for this row (multi-org mode)
            let resolvedOrgId = orgId;
            if (!orgId && built.orgInfo && orgCache) {
              try {
                await limiter.acquire();
                resolvedOrgId = await orgCache.resolve({
                  orgId: built.orgInfo.orgId,
                  orgExternalId: built.orgInfo.orgExternalId,
                  createIfMissing: Boolean(built.orgInfo.orgName),
                  orgName: built.orgInfo.orgName
                });

                if (!resolvedOrgId) {
                  chunkFailures += 1;
                  recordError({
                    recordNumber: currentRecordNumber,
                    email: payload.email,
                    errorType: "org_resolution",
                    errorMessage: `Organization not found: ${built.orgInfo.orgExternalId || built.orgInfo.orgId}`,
                    orgId: built.orgInfo.orgId,
                    orgExternalId: built.orgInfo.orgExternalId,
                    timestamp: new Date().toISOString(),
                    rawRow: currentRow
                  });
                  return;
                }
              } catch (err: any) {
                chunkFailures += 1;
                recordError({
                  recordNumber: currentRecordNumber,
                  email: payload.email,
                  errorType: "org_resolution",
                  errorMessage: err.message || String(err),
                  orgId: built.orgInfo.orgId,
                  orgExternalId: built.orgInfo.orgExternalId,
                  timestamp: new Date().toISOString(),
                  rawRow: currentRow
                });
                return;
              }
            }

            // Create user
            if (!dryRun) {
              try {
                await limiter.acquire();
                const createdUserId = await retryCreateUser(payload, limiter);

                // Create membership if org specified
                if (resolvedOrgId) {
                  try {
                    await limiter.acquire();
                    await retryCreateOrganizationMembership(createdUserId, resolvedOrgId, limiter);
                    chunkMemberships += 1;
                  } catch (membershipErr: any) {
                    if (requireMembership) {
                      await deleteUserSafe(createdUserId);
                      chunkFailures += 1;
                      recordError({
                        recordNumber: currentRecordNumber,
                        email: payload.email,
                        userId: createdUserId,
                        errorType: "membership_create",
                        errorMessage: membershipErr.message || String(membershipErr),
                        httpStatus: membershipErr.status,
                        workosCode: membershipErr.code,
                        workosRequestId: membershipErr.requestId,
                        timestamp: new Date().toISOString(),
                        rawRow: currentRow
                      });
                      return;
                    }
                  }
                }

                chunkSuccesses += 1;
              } catch (userErr: any) {
                chunkFailures += 1;
                recordError({
                  recordNumber: currentRecordNumber,
                  email: payload.email,
                  errorType: "user_create",
                  errorMessage: userErr.message || String(userErr),
                  httpStatus: userErr.status,
                  workosCode: userErr.code,
                  workosRequestId: userErr.requestId,
                  timestamp: new Date().toISOString(),
                  rawRow: currentRow
                });
              }
            } else {
              chunkSuccesses += 1;
            }
          } finally {
            sem.release();
          }
        })();

        inFlight.push(run);
      }
    });

    parser.on("end", () => resolve());
    parser.on("error", (err) => reject(err));

    input.pipe(parser);
  });

  // Wait for all in-flight tasks
  await Promise.all(inFlight);

  // Close error stream
  if (errorStream) {
    await new Promise<void>((resolve, reject) => {
      errorStream!.end((err?: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  const chunkDuration = Date.now() - chunkStartTime;

  return {
    successes: chunkSuccesses,
    failures: chunkFailures,
    membershipsCreated: chunkMemberships,
    usersCreated: chunkUsersCreated,
    duplicateUsers: chunkDuplicateUsers,
    duplicateMemberships: chunkDuplicateMemberships,
    durationMs: chunkDuration
  };
}

/**
 * Phase 4: Worker pool mode for parallel processing
 * Uses multiple worker threads to process chunks in parallel
 */
async function importUsersWorkerMode(options: ImportOptions): Promise<{
  summary: ImportSummary;
  errors: ErrorRecord[];
}> {
  const { checkpointManager, quiet, dryRun, numWorkers = 4 } = options;

  if (!checkpointManager) {
    throw new Error("Checkpoint manager required for worker mode");
  }

  const logger = createLogger({ quiet });
  const state = checkpointManager.getState();

  // Initialize organization cache for multi-org mode
  let orgCache: OrganizationCache | null = null;
  if (state.mode === 'multi-org') {
    orgCache = checkpointManager.restoreCache(dryRun);
    if (orgCache) {
      logger.log(`Restored organization cache: ${orgCache.getStats().size} entries`);
    } else {
      orgCache = new OrganizationCache({ maxSize: 10000, dryRun });
      logger.log("Multi-org mode: Organization cache initialized");
    }
  }

  // Import WorkerCoordinator dynamically to avoid circular dependency
  const { WorkerCoordinator } = await import('./workers/coordinator.js');

  // Create worker import options
  const workerOptions = {
    csvPath: options.csvPath,
    concurrency: options.concurrency ?? 10,
    orgId: options.orgId ?? null,
    requireMembership: options.requireMembership ?? false,
    dryRun: options.dryRun ?? false
  };

  // Create and start coordinator
  const coordinator = new WorkerCoordinator(
    {
      checkpointManager,
      numWorkers,
      orgCache,
      importOptions: workerOptions as any
    },
    logger
  );

  logger.log(`Starting parallel import with ${numWorkers} workers...`);
  const summary = await coordinator.start();

  return { summary, errors: [] }; // Errors streamed to checkpoint dir
}

/**
 * Helper: Format duration in ms to human-readable string
 */
function formatDuration(ms: number): string {
  if (ms < 60000) {
    return `${Math.round(ms / 1000)}s`;
  } else if (ms < 3600000) {
    return `${Math.round(ms / 60000)}m`;
  } else {
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.round((ms % 3600000) / 60000);
    return `${hours}h ${minutes}m`;
  }
}
