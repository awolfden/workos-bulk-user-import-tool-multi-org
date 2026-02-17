import { getOrganizationById, getOrganizationByExternalId, createOrganization } from "../orgs.js";

/**
 * Organization Cache
 *
 * LRU cache with concurrent request coalescing for organization lookups.
 *
 * Features:
 * - LRU eviction at configurable capacity (default: 10,000 entries)
 * - Concurrent request coalescing (prevents duplicate API calls)
 * - Dual-key caching: by org_id and org_external_id
 * - Statistics tracking (hits, misses, evictions, hit rate)
 * - Optional TTL support (disabled by default for import use cases)
 *
 * Performance:
 * - 99%+ hit rate for typical workloads (100-1,000 orgs, 10K+ users)
 * - Memory: ~5-10MB for 10K cached organizations
 * - Prevents thundering herd via request coalescing
 */

export interface OrganizationCacheStats {
  hits: number;
  misses: number;
  evictions: number;
  size: number;
  capacity: number;
  hitRate: number; // computed: hits / (hits + misses), 0-1
}

export interface OrganizationCacheEntry {
  id: string;
  externalId?: string;
  name?: string;
  cachedAt: number;
  ttl?: number; // milliseconds, optional
}

export interface OrganizationResolveOptions {
  orgId?: string;
  orgExternalId?: string;
  createIfMissing?: boolean;
  orgName?: string;
}

export interface OrganizationCacheOptions {
  maxSize?: number; // default: 10000
  enableTTL?: boolean; // default: false
  defaultTTLMs?: number; // default: 3600000 (1 hour)
  dryRun?: boolean; // default: false - skip API calls in dry-run mode
}

export class OrganizationCache {
  private cache: Map<string, OrganizationCacheEntry>;
  private inFlightRequests: Map<string, Promise<string | null>>;
  private stats: {
    hits: number;
    misses: number;
    evictions: number;
  };
  private readonly maxSize: number;
  private readonly enableTTL: boolean;
  private readonly defaultTTLMs: number;
  private readonly dryRun: boolean;

  constructor(options?: OrganizationCacheOptions) {
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
    this.dryRun = options?.dryRun ?? false;
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
  async resolve(options: OrganizationResolveOptions): Promise<string | null> {
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
    const requestPromise = this.fetchAndCache(
      cacheKey,
      orgId,
      orgExternalId,
      createIfMissing,
      orgName
    );

    // Track in-flight request
    this.inFlightRequests.set(cacheKey, requestPromise);

    try {
      const result = await requestPromise;
      return result;
    } finally {
      // Clean up in-flight tracking
      this.inFlightRequests.delete(cacheKey);
    }
  }

  /**
   * Get entry from cache (checks TTL if enabled)
   */
  private get(key: string): OrganizationCacheEntry | null {
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
  private set(key: string, entry: OrganizationCacheEntry): void {
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
  private async fetchAndCache(
    cacheKey: string,
    orgId?: string,
    orgExternalId?: string,
    createIfMissing?: boolean,
    orgName?: string
  ): Promise<string | null> {
    this.stats.misses += 1;

    // In dry-run mode, skip API calls and use provided IDs directly
    if (this.dryRun) {
      let resolvedOrgId: string | null = null;

      if (orgId) {
        // Use org ID directly without validation
        resolvedOrgId = orgId;
      } else if (orgExternalId) {
        // Generate fake org ID from external ID for dry-run
        resolvedOrgId = `org_dryrun_${orgExternalId}`;
      }

      // Cache the dry-run result
      if (resolvedOrgId) {
        const entry: OrganizationCacheEntry = {
          id: resolvedOrgId,
          externalId: orgExternalId,
          name: orgName,
          cachedAt: Date.now(),
          ttl: this.enableTTL ? this.defaultTTLMs : undefined
        };
        this.set(cacheKey, entry);
      }

      return resolvedOrgId;
    }

    try {
      let resolvedOrgId: string | null = null;

      if (orgId) {
        // Direct ID lookup
        const exists = await getOrganizationById(orgId);
        resolvedOrgId = exists ? orgId : null;
      } else if (orgExternalId) {
        // External ID lookup
        resolvedOrgId = await getOrganizationByExternalId(orgExternalId);

        // Create if not found and requested
        if (!resolvedOrgId && createIfMissing && orgName) {
          try {
            resolvedOrgId = await createOrganization(orgName, orgExternalId);
          } catch (err: any) {
            // Check if error is due to external_id conflict (race condition)
            // This happens when multiple workers try to create the same org simultaneously
            const errorMsg = err?.message || '';
            const isExternalIdConflict =
              errorMsg.includes('external_id') &&
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
                throw new Error(
                  `Organization with external_id "${orgExternalId}" reported as ` +
                  `existing but could not be retrieved after ${maxRetries} retries. ` +
                  `Original error: ${errorMsg}`
                );
              }

              // Successfully resolved via retry - continue to cache it below
            } else {
              // Different error - re-throw
              throw err;
            }
          }
        }
      }

      // Cache the result if found
      if (resolvedOrgId) {
        const entry: OrganizationCacheEntry = {
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
        } else if (resolvedOrgId && orgExternalId) {
          // We resolved via external_id, also cache by org_id
          const idKey = this.generateCacheKey(resolvedOrgId, undefined);
          this.set(idKey, entry);
        }
      }

      return resolvedOrgId;
    } catch (err) {
      // API errors bubble up (not cached)
      throw err;
    }
  }

  /**
   * Generate consistent cache key from org identifiers
   */
  private generateCacheKey(orgId?: string, orgExternalId?: string): string {
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
  getStats(): OrganizationCacheStats {
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
  resetStats(): void {
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0
    };
  }

  /**
   * Clear cache and statistics
   */
  clear(): void {
    this.cache.clear();
    this.inFlightRequests.clear();
    this.resetStats();
  }

  /**
   * Phase 3: Serialize cache for checkpoint storage
   * Returns array of cache entries (without in-flight requests)
   */
  serialize(): import('../checkpoint/types.js').SerializedCacheEntry[] {
    const entries: import('../checkpoint/types.js').SerializedCacheEntry[] = [];

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
  static deserialize(
    entries: import('../checkpoint/types.js').SerializedCacheEntry[],
    options?: OrganizationCacheOptions
  ): OrganizationCache {
    const cache = new OrganizationCache(options);

    for (const entry of entries) {
      const cacheEntry: OrganizationCacheEntry = {
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

  /**
   * Phase 4: Merge cache entries from worker
   * Only adds entries that don't already exist (workers send all their entries)
   */
  mergeEntries(entries: import('../checkpoint/types.js').SerializedCacheEntry[]): void {
    for (const entry of entries) {
      // Only add if not already in cache
      if (!this.cache.has(entry.key)) {
        const cacheEntry: OrganizationCacheEntry = {
          id: entry.id,
          externalId: entry.externalId,
          name: entry.name,
          cachedAt: Date.now(),
          ttl: this.enableTTL ? this.defaultTTLMs : undefined
        };

        this.cache.set(entry.key, cacheEntry);
      }
    }
  }
}
