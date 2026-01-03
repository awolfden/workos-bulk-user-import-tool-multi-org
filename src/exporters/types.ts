/**
 * Provider-agnostic exporter types
 * Defines common interfaces for all identity provider exporters
 */

import type { CSVRow } from '../types.js';

/**
 * Credentials for different identity providers
 */
export type ProviderCredentials = Auth0Credentials | OktaCredentials | CognitoCredentials;

export interface Auth0Credentials {
  type: 'auth0';
  domain: string; // e.g., tenant.auth0.com
  clientId: string;
  clientSecret: string;
  audience?: string; // Default: https://{domain}/api/v2/
}

export interface OktaCredentials {
  type: 'okta';
  domain: string;
  apiToken: string;
}

export interface CognitoCredentials {
  type: 'cognito';
  region: string;
  userPoolId: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/**
 * Configuration for exporters
 */
export interface ExporterConfig {
  /** Identity provider credentials (Auth0, Okta, Cognito, etc.) */
  credentials: ProviderCredentials;

  /** Absolute path where the CSV output file will be written */
  outputPath: string;

  // Performance tuning
  /**
   * Number of items to fetch per API request
   * @default 100
   * @min 1
   * @max 100
   */
  pageSize?: number;

  /**
   * Number of concurrent API requests (future use)
   * @default 5
   */
  concurrency?: number;

  // Filtering
  /**
   * Array of organization IDs to export (exports all if not specified)
   * @example ["org_123", "org_456"]
   */
  organizationFilter?: string[];

  /**
   * Include deleted/deactivated users in export
   * @default false
   */
  includeDeleted?: boolean;

  // Export mode
  /**
   * Export password hashes (requires special Auth0 permission)
   * Only works if your Auth0 M2M app has 'read:user_idp_tokens' scope
   * @default false
   */
  includePasswordHashes?: boolean;

  /**
   * Use user_metadata instead of Organizations API
   * Required for Auth0 non-Enterprise plans or when Organizations API is unavailable
   * When enabled, reads organization info from user_metadata fields
   * @default false
   */
  useMetadata?: boolean;

  // Metadata mode configuration (only used when useMetadata=true)
  /**
   * Custom metadata field name for organization ID
   * Checked before default fields: organization_id, org_id, organizationId
   * Only used when useMetadata is true
   * @example "company_id", "tenant_id", "account_id"
   */
  metadataOrgIdField?: string;

  /**
   * Custom metadata field name for organization name
   * Checked before default fields: organization_name, org_name, organizationName
   * Only used when useMetadata is true
   * @example "company_name", "tenant_name", "account_name"
   */
  metadataOrgNameField?: string;

  // Output control
  /**
   * Suppress progress output during export
   * @default false
   */
  quiet?: boolean;

  /**
   * Callback function called during export with progress statistics
   * Invoked every 100 users processed
   */
  onProgress?: (stats: ExportProgress) => void;
}

/**
 * Progress statistics during export
 */
export interface ExportProgress {
  usersProcessed: number;
  orgsProcessed: number;
  currentOrg?: string;
  estimatedTotal?: number;
  elapsedMs: number;
  estimatedRemainingMs?: number;
}

/**
 * Result of export operation
 */
export interface ExportResult {
  outputPath: string;
  summary: ExportSummary;
  warnings: string[];
}

export interface ExportSummary {
  totalUsers: number;
  totalOrgs: number;
  skippedUsers: number; // Users without email or other issues
  startedAt: number;
  endedAt: number;
  durationMs: number;
}

/**
 * Auth0-specific types
 */
export interface Auth0User {
  user_id: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
  nickname?: string;
  picture?: string;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  last_login?: string;
  logins_count?: number;
  identities?: Array<{
    provider: string;
    user_id: string;
    connection: string;
    isSocial: boolean;
  }>;
}

export interface Auth0Organization {
  id: string;
  name: string;
  display_name?: string;
  branding?: {
    logo_url?: string;
    colors?: Record<string, string>;
  };
  metadata?: Record<string, unknown>;
}

/**
 * Base exporter interface
 * All provider exporters should implement this
 */
export interface BaseExporter {
  export(): Promise<ExportResult>;
  validate?(): Promise<{ valid: boolean; errors: string[] }>;
}

/**
 * Utility type for mapping provider users to WorkOS CSV format
 */
export type UserMapper<T> = (
  user: T,
  org: { id: string; name: string }
) => CSVRow;
