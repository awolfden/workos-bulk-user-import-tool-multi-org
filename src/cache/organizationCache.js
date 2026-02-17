import { getOrganizationById, getOrganizationByExternalId, createOrganization } from "../orgs.js";
export class OrganizationCache {
    cache;
    inFlightRequests;
    stats;
    maxSize;
    enableTTL;
    defaultTTLMs;
    constructor(options) {
        this.cache = new Map();
        this.inFlightRequests = new Map();
        this.stats = {
            hits: 0,
            misses: 0,
            evictions: 0
        };
        this.maxSize = options?.maxSize ?? 10000;
        this.enableTTL = options?.enableTTL ?? false;
        this.defaultTTLMs = options?.defaultTTLMs ?? 3600000; // 1 hour default
    }
    /**
     * Resolve organization ID from various inputs
     *
     * Resolution priority:
     * 1. If orgId provided → Direct lookup (cached)
     * 2. If orgExternalId provided → API lookup (cached by external_id)
     * 3. If organization not found and createIfMissing + orgName → Create new org
     * 4. If organization not found and no creation → return null
     *
     * @param options Resolution options
     * @returns WorkOS organization ID or null if not found
     * @throws Error if both orgId and orgExternalId provided
     * @throws Error if API call fails (404s return null, not throw)
     */
    async resolve(options) {
        const { orgId, orgExternalId, createIfMissing, orgName } = options;
        // Validation: cannot have both
        if (orgId && orgExternalId) {
            throw new Error("Cannot specify both orgId and orgExternalId");
        }
        // No org specified
        if (!orgId && !orgExternalId) {
            return null;
        }
        // Generate cache key
        const cacheKey = this.generateCacheKey(orgId, orgExternalId);
        // Check cache first
        const cached = this.get(cacheKey);
        if (cached) {
            this.stats.hits += 1;
            return cached.id;
        }
        // Check if request is already in-flight (coalescing)
        const inFlight = this.inFlightRequests.get(cacheKey);
        if (inFlight) {
            // Wait for in-flight request to complete
            return await inFlight;
        }
        // Create new request promise
        const requestPromise = this.fetchAndCache(cacheKey, orgId, orgExternalId, createIfMissing, orgName);
        // Track in-flight request
        this.inFlightRequests.set(cacheKey, requestPromise);
        try {
            const result = await requestPromise;
            return result;
        }
        finally {
            // Clean up in-flight tracking
            this.inFlightRequests.delete(cacheKey);
        }
    }
    /**
     * Get entry from cache (checks TTL if enabled)
     */
    get(key) {
        const entry = this.cache.get(key);
        if (!entry) {
            return null;
        }
        // Check TTL if enabled
        if (this.enableTTL && entry.ttl) {
            const now = Date.now();
            const age = now - entry.cachedAt;
            if (age > entry.ttl) {
                // Expired, remove from cache
                this.cache.delete(key);
                return null;
            }
        }
        // Move to end (LRU: accessed = most recent)
        this.cache.delete(key);
        this.cache.set(key, entry);
        return entry;
    }
    /**
     * Set entry in cache (with LRU eviction if needed)
     */
    set(key, entry) {
        // LRU eviction if at capacity
        if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
            // Evict oldest (first) entry
            const firstKey = this.cache.keys().next().value;
            if (firstKey) {
                this.cache.delete(firstKey);
                this.stats.evictions += 1;
            }
        }
        // Add/update entry (moves to end)
        this.cache.set(key, entry);
    }
    /**
     * Fetch organization from API and cache result
     */
    async fetchAndCache(cacheKey, orgId, orgExternalId, createIfMissing, orgName) {
        this.stats.misses += 1;
        try {
            let resolvedOrgId = null;
            if (orgId) {
                // Direct ID lookup
                const exists = await getOrganizationById(orgId);
                resolvedOrgId = exists ? orgId : null;
            }
            else if (orgExternalId) {
                // External ID lookup
                resolvedOrgId = await getOrganizationByExternalId(orgExternalId);
                // Create if not found and requested
                if (!resolvedOrgId && createIfMissing && orgName) {
                    try {
                        resolvedOrgId = await createOrganization(orgName, orgExternalId);
                    }
                    catch (err) {
                        // Check if error is due to external_id conflict (race condition)
                        // This happens when multiple workers try to create the same org simultaneously
                        const errorMsg = err?.message || '';
                        const isExternalIdConflict = errorMsg.includes('external_id') &&
                            errorMsg.includes('already been assigned');
                        if (isExternalIdConflict) {
                            // Another worker created this org - retry lookup with backoff
                            // API may have eventual consistency delay
                            const maxRetries = 3;
                            const retryDelayMs = 500;
                            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                                // Wait before retry (except first attempt)
                                if (attempt > 1) {
                                    await new Promise(resolve => setTimeout(resolve, retryDelayMs * attempt));
                                }
                                resolvedOrgId = await getOrganizationByExternalId(orgExternalId);
                                if (resolvedOrgId) {
                                    // Successfully found after retry
                                    break;
                                }
                            }
                            if (!resolvedOrgId) {
                                // Still not found after retries - API inconsistency or other issue
                                throw new Error(`Organization with external_id "${orgExternalId}" reported as ` +
                                    `existing but could not be retrieved after ${maxRetries} retries. ` +
                                    `Original error: ${errorMsg}`);
                            }
                            // Successfully resolved via retry - continue to cache it below
                        }
                        else {
                            // Different error - re-throw
                            throw err;
                        }
                    }
                }
            }
            // Cache the result if found
            if (resolvedOrgId) {
                const entry = {
                    id: resolvedOrgId,
                    externalId: orgExternalId,
                    name: orgName,
                    cachedAt: Date.now(),
                    ttl: this.enableTTL ? this.defaultTTLMs : undefined
                };
                // Cache by both keys if we have both IDs
                this.set(cacheKey, entry);
                // Also cache by the other key for future lookups
                if (orgId && orgExternalId) {
                    const altKey = this.generateCacheKey(undefined, orgExternalId);
                    this.set(altKey, entry);
                }
                else if (resolvedOrgId && orgExternalId) {
                    // We resolved via external_id, also cache by org_id
                    const idKey = this.generateCacheKey(resolvedOrgId, undefined);
                    this.set(idKey, entry);
                }
            }
            return resolvedOrgId;
        }
        catch (err) {
            // API errors bubble up (not cached)
            throw err;
        }
    }
    /**
     * Generate consistent cache key from org identifiers
     */
    generateCacheKey(orgId, orgExternalId) {
        if (orgId) {
            return `id:${orgId}`;
        }
        if (orgExternalId) {
            return `ext:${orgExternalId}`;
        }
        throw new Error("Must provide orgId or orgExternalId for cache key");
    }
    /**
     * Get cache statistics
     */
    getStats() {
        const total = this.stats.hits + this.stats.misses;
        const hitRate = total > 0 ? this.stats.hits / total : 0;
        return {
            hits: this.stats.hits,
            misses: this.stats.misses,
            evictions: this.stats.evictions,
            size: this.cache.size,
            capacity: this.maxSize,
            hitRate
        };
    }
    /**
     * Reset statistics (keeps cache intact)
     */
    resetStats() {
        this.stats = {
            hits: 0,
            misses: 0,
            evictions: 0
        };
    }
    /**
     * Clear cache and statistics
     */
    clear() {
        this.cache.clear();
        this.inFlightRequests.clear();
        this.resetStats();
    }
    /**
     * Phase 3: Serialize cache for checkpoint storage
     * Returns array of cache entries (without in-flight requests)
     */
    serialize() {
        const entries = [];
        for (const [key, entry] of this.cache.entries()) {
            entries.push({
                key,
                id: entry.id,
                externalId: entry.externalId,
                name: entry.name
            });
        }
        return entries;
    }
    /**
     * Phase 3: Deserialize cache from checkpoint
     * Restores cache entries from serialized format
     */
    static deserialize(entries, options) {
        const cache = new OrganizationCache(options);
        for (const entry of entries) {
            const cacheEntry = {
                id: entry.id,
                externalId: entry.externalId,
                name: entry.name,
                cachedAt: Date.now(), // Fresh timestamp on restore
                ttl: cache.enableTTL ? cache.defaultTTLMs : undefined
            };
            cache.cache.set(entry.key, cacheEntry);
        }
        return cache;
    }
}
