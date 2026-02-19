/** Row from the role definitions CSV */
export interface RoleDefinitionRow {
  role_slug: string;          // Required: unique identifier
  role_name: string;          // Required: display name
  role_type: 'environment' | 'organization'; // Required
  permissions: string;        // Comma-separated or JSON array
  // Only for organization roles:
  org_id?: string;
  org_external_id?: string;
}

/** Parsed role definition (after CSV parsing) */
export interface ParsedRoleDefinition {
  slug: string;
  name: string;
  type: 'environment' | 'organization';
  permissions: string[];
  orgId?: string;             // Resolved WorkOS org ID
  orgExternalId?: string;     // Original external ID (for resolution)
}

/** Result of processing a single role definition */
export interface RoleProcessingResult {
  slug: string;
  action: 'created' | 'exists' | 'skipped' | 'error';
  warnings: string[];
  error?: string;
  permissionDiff?: {
    csvPermissions: string[];
    existingPermissions: string[];
    missing: string[];    // In CSV but not in WorkOS
    extra: string[];      // In WorkOS but not in CSV
  };
}

/** Summary of role definitions processing */
export interface RoleDefinitionsSummary {
  total: number;
  created: number;
  alreadyExist: number;
  skipped: number;
  errors: number;
  warnings: string[];
  results: RoleProcessingResult[];
}

/** Cached role entry */
export interface RoleCacheEntry {
  slug: string;
  id: string;
  name: string;
  permissions: string[];
  type: 'EnvironmentRole' | 'OrganizationRole';
  orgId?: string;           // For org-level roles
  cachedAt: number;
}

/** Role cache stats */
export interface RoleCacheStats {
  hits: number;
  misses: number;
  size: number;
  capacity: number;
  hitRate: number;
}

/** Serialized role cache entry for checkpoint storage */
export interface SerializedRoleCacheEntry {
  key: string;
  slug: string;
  id: string;
  name: string;
  permissions: string[];
  type: 'EnvironmentRole' | 'OrganizationRole';
  orgId?: string;
}
