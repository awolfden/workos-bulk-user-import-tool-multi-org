/**
 * Phase 4: Chunk processing logic for worker threads
 *
 * This module extracts the core chunk processing logic from Phase 3's processChunk()
 * and adapts it to work in a worker thread context with distributed rate limiting.
 */
import fs from 'node:fs';
import { parse } from 'csv-parse';
import { getWorkOSClient } from '../workos.js';
import { createLogger } from '../logger.js';
import { parseBooleanLike } from '../boolean.js';
/**
 * Semaphore for concurrency control within worker
 */
class Semaphore {
    max;
    count;
    queue;
    constructor(max) {
        this.max = Math.max(1, max);
        this.count = 0;
        this.queue = [];
    }
    async acquire() {
        if (this.count < this.max) {
            this.count += 1;
            return;
        }
        await new Promise(resolve => {
            this.queue.push(() => {
                this.count += 1;
                resolve();
            });
        });
    }
    release() {
        this.count -= 1;
        const next = this.queue.shift();
        if (next)
            next();
    }
}
/**
 * Build user payload and org info from CSV row
 */
function buildUserAndOrgFromRow(row) {
    // Extract and validate email
    const email = typeof row.email === 'string' ? row.email.trim() : '';
    if (!email) {
        return { error: 'Missing required email' };
    }
    // Extract user fields
    const password = typeof row.password === 'string' ? row.password : undefined;
    const passwordHash = typeof row.password_hash === 'string' ? row.password_hash : undefined;
    const passwordHashType = typeof row.password_hash_type === 'string' ? row.password_hash_type : undefined;
    const firstName = typeof row.first_name === 'string' ? row.first_name : undefined;
    const lastName = typeof row.last_name === 'string' ? row.last_name : undefined;
    const emailVerifiedParsed = parseBooleanLike(row.email_verified);
    const externalId = typeof row.external_id === 'string' ? row.external_id : undefined;
    let metadata;
    if (typeof row.metadata === 'string') {
        const trimmed = row.metadata.trim();
        if (trimmed.length > 0) {
            try {
                metadata = JSON.parse(trimmed);
            }
            catch {
                return { error: 'Invalid JSON in metadata field' };
            }
        }
    }
    // Build user payload
    const userPayload = {
        email,
        firstName,
        lastName,
        password,
        passwordHash,
        passwordHashType,
        emailVerified: emailVerifiedParsed,
        externalId,
        metadata
    };
    // Extract organization info (multi-org mode)
    const orgInfo = {
        orgId: typeof row.org_id === 'string' ? row.org_id : undefined,
        orgExternalId: typeof row.org_external_id === 'string' ? row.org_external_id : undefined,
        orgName: typeof row.org_name === 'string' ? row.org_name : undefined
    };
    return { userPayload, orgInfo };
}
/**
 * Retry user creation with exponential backoff on rate limits
 */
async function retryCreateUser(payload, limiter, maxRetries = 3, baseDelayMs = 500) {
    const workos = getWorkOSClient();
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
        try {
            await limiter.acquire();
            const user = await workos.userManagement.createUser(payload);
            return user?.id;
        }
        catch (err) {
            const status = err?.status ?? err?.httpStatus ?? err?.code ?? err?.response?.status;
            const message = err?.message || 'Unknown error';
            const isRateLimited = status === 429 || /rate.?limit/i.test(message);
            attempt += 1;
            if (isRateLimited && attempt <= maxRetries) {
                let delay = baseDelayMs * Math.pow(2, attempt - 1);
                // Respect Retry-After header if provided
                const retryAfter = err?.response?.headers?.['retry-after'] ?? err?.response?.headers?.['Retry-After'];
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
/**
 * Retry organization membership creation with exponential backoff
 */
async function retryCreateOrganizationMembership(userId, organizationId, limiter, maxRetries = 3, baseDelayMs = 500) {
    const workos = getWorkOSClient();
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
        try {
            await limiter.acquire();
            await workos.userManagement.createOrganizationMembership({
                userId,
                organizationId
            });
            return;
        }
        catch (err) {
            const status = err?.status ?? err?.httpStatus ?? err?.response?.status;
            const message = err?.message || 'Unknown error';
            const isRateLimited = status === 429 || /rate.?limit/i.test(message);
            attempt += 1;
            if (isRateLimited && attempt <= maxRetries) {
                let delay = baseDelayMs * Math.pow(2, attempt - 1);
                const retryAfter = err?.response?.headers?.['retry-after'] ?? err?.response?.headers?.['Retry-After'];
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
/**
 * Best-effort user deletion (used for cleanup on membership failure)
 */
async function deleteUserSafe(userId) {
    const workos = getWorkOSClient();
    try {
        await workos.userManagement.deleteUser(userId);
    }
    catch {
        // Best-effort delete; ignore errors
    }
}
/**
 * Process a single chunk in worker thread context
 *
 * Re-parses CSV from start, skips to chunk range, processes chunk rows
 * Uses distributed rate limiter to coordinate with other workers via coordinator
 *
 * @param chunk - Chunk metadata with start/end rows
 * @param options - Worker import options
 * @param orgCache - Local organization cache (null for single-org mode)
 * @param rateLimiter - Distributed rate limiter for coordinator IPC
 * @param checkpointDir - Directory for error streaming
 * @returns Chunk summary with successes/failures/memberships/duration
 */
export async function processChunkInWorker(chunk, options, orgCache, rateLimiter, checkpointDir) {
    const { csvPath, concurrency = 10, orgId = null, requireMembership = false, dryRun = false } = options;
    const logger = createLogger({ quiet: true }); // Quiet for individual rows
    const sem = new Semaphore(concurrency);
    const chunkStartTime = Date.now();
    let chunkSuccesses = 0;
    let chunkFailures = 0;
    let chunkMemberships = 0;
    // Set up error streaming to checkpoint dir
    const errorPath = `${checkpointDir}/errors.jsonl`;
    const errorStream = fs.createWriteStream(errorPath, { flags: 'a', encoding: 'utf8' });
    const recordError = (errRec) => {
        errorStream.write(JSON.stringify(errRec) + '\n');
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
    const inFlight = [];
    await new Promise((resolve, reject) => {
        parser.on('readable', async () => {
            let row;
            while ((row = parser.read()) !== null) {
                recordNumber++;
                // Skip rows before chunk start or after chunk end
                if (recordNumber < chunk.startRow || recordNumber > chunk.endRow) {
                    continue;
                }
                // Capture row value for closure
                const currentRow = row;
                const currentRecordNumber = recordNumber;
                // Process row
                const run = (async () => {
                    await sem.acquire();
                    try {
                        const built = buildUserAndOrgFromRow(currentRow);
                        if (built.error) {
                            chunkFailures += 1;
                            recordError({
                                recordNumber: currentRecordNumber,
                                email: String(currentRow.email ?? ''),
                                errorType: 'user_create',
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
                                await rateLimiter.acquire();
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
                                        errorType: 'org_resolution',
                                        errorMessage: `Organization not found: ${built.orgInfo.orgExternalId || built.orgInfo.orgId}`,
                                        orgId: built.orgInfo.orgId,
                                        orgExternalId: built.orgInfo.orgExternalId,
                                        timestamp: new Date().toISOString(),
                                        rawRow: currentRow
                                    });
                                    return;
                                }
                            }
                            catch (err) {
                                chunkFailures += 1;
                                recordError({
                                    recordNumber: currentRecordNumber,
                                    email: payload.email,
                                    errorType: 'org_resolution',
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
                                const createdUserId = await retryCreateUser(payload, rateLimiter);
                                // Create membership if org specified
                                if (resolvedOrgId) {
                                    try {
                                        await retryCreateOrganizationMembership(createdUserId, resolvedOrgId, rateLimiter);
                                        chunkMemberships += 1;
                                    }
                                    catch (membershipErr) {
                                        if (requireMembership) {
                                            await deleteUserSafe(createdUserId);
                                            chunkFailures += 1;
                                            recordError({
                                                recordNumber: currentRecordNumber,
                                                email: payload.email,
                                                userId: createdUserId,
                                                errorType: 'membership_create',
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
                            }
                            catch (userErr) {
                                chunkFailures += 1;
                                recordError({
                                    recordNumber: currentRecordNumber,
                                    email: payload.email,
                                    errorType: 'user_create',
                                    errorMessage: userErr.message || String(userErr),
                                    httpStatus: userErr.status,
                                    workosCode: userErr.code,
                                    workosRequestId: userErr.requestId,
                                    timestamp: new Date().toISOString(),
                                    rawRow: currentRow
                                });
                            }
                        }
                        else {
                            chunkSuccesses += 1;
                        }
                    }
                    finally {
                        sem.release();
                    }
                })();
                inFlight.push(run);
            }
        });
        parser.on('end', () => resolve());
        parser.on('error', (err) => reject(err));
        input.pipe(parser);
    });
    // Wait for all in-flight tasks
    await Promise.all(inFlight);
    // Close error stream
    await new Promise((resolve, reject) => {
        errorStream.end((err) => {
            if (err)
                reject(err);
            else
                resolve();
        });
    });
    const chunkDuration = Date.now() - chunkStartTime;
    return {
        successes: chunkSuccesses,
        failures: chunkFailures,
        membershipsCreated: chunkMemberships,
        durationMs: chunkDuration
    };
}
