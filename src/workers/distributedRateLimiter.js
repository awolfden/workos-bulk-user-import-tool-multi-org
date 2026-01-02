/**
 * Phase 4: Distributed rate limiter for worker threads
 *
 * Workers use this to request rate limit tokens from the coordinator
 * via IPC messages. The coordinator manages the global token bucket.
 */
import { parentPort } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
/**
 * Worker-side rate limiter that requests tokens from coordinator via IPC
 *
 * Usage:
 *   const limiter = new DistributedRateLimiter();
 *   await limiter.acquire(); // Blocks until coordinator grants token
 */
export class DistributedRateLimiter {
    pendingRequests;
    messageHandler = null;
    constructor() {
        this.pendingRequests = new Map();
        this.setupMessageHandler();
    }
    /**
     * Acquire a rate limit token from the coordinator
     * Sends 'rate-limit-request' message and waits for 'rate-limit-grant'
     *
     * @throws Error if timeout (5 seconds) is reached without grant
     */
    async acquire() {
        const requestId = randomUUID();
        return new Promise((resolve, reject) => {
            // Set 5-second timeout
            const timeout = setTimeout(() => {
                this.pendingRequests.delete(requestId);
                reject(new Error(`Rate limit request timeout after 5s (requestId: ${requestId})`));
            }, 5000);
            // Store pending request
            this.pendingRequests.set(requestId, { resolve, reject, timeout });
            // Send request to coordinator
            if (!parentPort) {
                clearTimeout(timeout);
                this.pendingRequests.delete(requestId);
                reject(new Error('parentPort is null - not running in worker thread'));
                return;
            }
            parentPort.postMessage({
                type: 'rate-limit-request',
                requestId
            });
        });
    }
    /**
     * Setup message handler to receive rate limit grants from coordinator
     */
    setupMessageHandler() {
        if (!parentPort) {
            throw new Error('DistributedRateLimiter must be used in worker thread');
        }
        this.messageHandler = (msg) => {
            if (msg.type === 'rate-limit-grant' && typeof msg.requestId === 'string') {
                this.handleGrant(msg.requestId);
            }
        };
        parentPort.on('message', this.messageHandler);
    }
    /**
     * Handle rate limit grant from coordinator
     * Resolves the pending promise and cleans up timeout
     */
    handleGrant(requestId) {
        const pending = this.pendingRequests.get(requestId);
        if (pending) {
            clearTimeout(pending.timeout);
            this.pendingRequests.delete(requestId);
            pending.resolve();
        }
        // If no pending request found, grant arrived after timeout - ignore
    }
    /**
     * Cleanup: remove message handler and reject all pending requests
     * Call this when worker is shutting down
     */
    cleanup() {
        if (parentPort && this.messageHandler) {
            parentPort.off('message', this.messageHandler);
            this.messageHandler = null;
        }
        // Reject all pending requests
        for (const [requestId, pending] of this.pendingRequests.entries()) {
            clearTimeout(pending.timeout);
            pending.reject(new Error(`Worker shutting down (requestId: ${requestId})`));
        }
        this.pendingRequests.clear();
    }
    /**
     * Get number of pending rate limit requests
     * Useful for debugging/monitoring
     */
    getPendingCount() {
        return this.pendingRequests.size;
    }
}
