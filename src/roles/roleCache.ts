import type { RoleCacheEntry, RoleCacheStats, SerializedRoleCacheEntry } from './types.js';
import { listRolesForOrganization } from './roleApiClient.js';

export interface RoleCacheOptions {
  maxSize?: number;         // default: 1000
  dryRun?: boolean;
}

export class RoleCache {
  private cache: Map<string, RoleCacheEntry>;
  private inFlightRequests: Map<string, Promise<RoleCacheEntry | null>>;
  private stats: { hits: number; misses: number };
  private readonly maxSize: number;
  private readonly dryRun: boolean;

  constructor(options?: RoleCacheOptions) {
    this.cache = new Map();
    this.inFlightRequests = new Map();
    this.stats = { hits: 0, misses: 0 };
    this.maxSize = options?.maxSize ?? 1000;
    this.dryRun = options?.dryRun ?? false;
  }

  /** Generate cache key: env:{slug} for environment roles, org:{orgId}:{slug} for org roles */
  private generateKey(slug: string, orgId?: string): string {
    if (orgId) {
      return `org:${orgId}:${slug}`;
    }
    return `env:${slug}`;
  }

  /** Get entry from cache with LRU promotion */
  private get(key: string): RoleCacheEntry | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    // LRU: move to end (most recently accessed)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry;
  }

  /** Set entry in cache with LRU eviction */
  set(entry: RoleCacheEntry): void {
    const key = this.generateKey(
      entry.slug,
      entry.type === 'OrganizationRole' ? entry.orgId : undefined
    );

    // LRU eviction if at capacity
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, entry);
  }

  /** Resolve a role by slug, optionally scoped to an org */
  async resolve(slug: string, orgId?: string): Promise<RoleCacheEntry | null> {
    const key = this.generateKey(slug, orgId);

    // Check cache first
    const cached = this.get(key);
    if (cached) {
      this.stats.hits += 1;
      return cached;
    }

    // Check in-flight requests (coalescing)
    const inFlight = this.inFlightRequests.get(key);
    if (inFlight) {
      return await inFlight;
    }

    this.stats.misses += 1;

    // In dry-run mode, return null (no API calls)
    if (this.dryRun) {
      return null;
    }

    // If we have an orgId, try warming from that org (fetches all roles at once)
    if (orgId) {
      const warmPromise = this.warmFromOrganization(orgId).then(() => {
        return this.get(key);
      });

      this.inFlightRequests.set(key, warmPromise);

      try {
        return await warmPromise;
      } finally {
        this.inFlightRequests.delete(key);
      }
    }

    // For environment roles without an org context, we can't list them without an org
    // Return null - the caller will need to handle this
    return null;
  }

  /** Pre-populate cache with roles from an org listing */
  async warmFromOrganization(orgId: string): Promise<void> {
    if (this.dryRun) return;

    const roles = await listRolesForOrganization(orgId);

    for (const role of roles) {
      const entry: RoleCacheEntry = {
        slug: role.slug,
        id: role.id,
        name: role.name,
        permissions: role.permissions,
        type: role.type,
        orgId: role.type === 'OrganizationRole' ? orgId : undefined,
        cachedAt: Date.now(),
      };

      this.set(entry);
    }
  }

  /** Get cache statistics */
  getStats(): RoleCacheStats {
    const total = this.stats.hits + this.stats.misses;
    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      size: this.cache.size,
      capacity: this.maxSize,
      hitRate: total > 0 ? this.stats.hits / total : 0,
    };
  }

  /** Serialize for checkpoint storage */
  serialize(): SerializedRoleCacheEntry[] {
    const entries: SerializedRoleCacheEntry[] = [];

    for (const [key, entry] of this.cache.entries()) {
      entries.push({
        key,
        slug: entry.slug,
        id: entry.id,
        name: entry.name,
        permissions: entry.permissions,
        type: entry.type,
        orgId: entry.orgId,
      });
    }

    return entries;
  }

  /** Deserialize from checkpoint */
  static deserialize(
    entries: SerializedRoleCacheEntry[],
    options?: RoleCacheOptions
  ): RoleCache {
    const cache = new RoleCache(options);

    for (const entry of entries) {
      const cacheEntry: RoleCacheEntry = {
        slug: entry.slug,
        id: entry.id,
        name: entry.name,
        permissions: entry.permissions,
        type: entry.type,
        orgId: entry.orgId,
        cachedAt: Date.now(),
      };

      cache.cache.set(entry.key, cacheEntry);
    }

    return cache;
  }

  /** Clear cache and statistics */
  clear(): void {
    this.cache.clear();
    this.inFlightRequests.clear();
    this.stats = { hits: 0, misses: 0 };
  }
}
