/**
 * Auth0 to WorkOS field mapping
 * Transforms Auth0 user objects to WorkOS CSV format
 */

import type { Auth0User, Auth0Organization } from '../types.js';
import type { CSVRow } from '../../types.js';

/**
 * Sanitize metadata for WorkOS compatibility
 * WorkOS has specific requirements for metadata:
 * 1. All values must be strings (no booleans, numbers, arrays, or objects)
 * 2. Reserved field names: organization_id, organization_name
 *
 * @param metadata Raw metadata object
 * @returns Sanitized metadata object safe for WorkOS import (all values as strings)
 */
function sanitizeMetadataForWorkOS(metadata: Record<string, unknown>): Record<string, string> {
  const sanitized: Record<string, string> = {};

  for (const [key, value] of Object.entries(metadata)) {
    // Skip reserved field names that conflict with WorkOS organization handling
    if (key === 'organization_id' || key === 'organization_name' ||
        key === 'org_id' || key === 'org_name' ||
        key === 'organizationId' || key === 'organizationName') {
      // Rename with auth0_ prefix to preserve the data
      sanitized[`auth0_${key}`] = convertToString(value);
      continue;
    }

    // Convert all values to strings for WorkOS compatibility
    sanitized[key] = convertToString(value);
  }

  return sanitized;
}

/**
 * Convert any value to a string for WorkOS metadata
 * - Strings: return as-is
 * - Booleans: "true" or "false"
 * - Numbers: string representation
 * - Arrays/Objects: JSON.stringify
 * - null/undefined: empty string
 */
function convertToString(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number') {
    return String(value);
  }
  // Arrays and objects
  return JSON.stringify(value);
}

/**
 * Map Auth0 user to WorkOS CSV row
 * @param user Auth0 user object
 * @param org Auth0 organization object
 * @param passwordHash Optional password hash data
 */
export function mapAuth0UserToWorkOS(
  user: Auth0User,
  org: Auth0Organization,
  passwordHash?: { hash?: string; algorithm?: string } | null
): CSVRow {
  // Extract first and last name
  let firstName = user.given_name;
  let lastName = user.family_name;

  // Fallback: parse 'name' field if given_name/family_name not available
  if (!firstName && !lastName && user.name) {
    const nameParts = user.name.trim().split(/\s+/);
    firstName = nameParts[0];
    lastName = nameParts.slice(1).join(' ');
  }

  // Merge user_metadata and app_metadata into single metadata object
  const rawMetadata: Record<string, unknown> = {
    ...user.user_metadata,
    ...user.app_metadata
  };

  // Add Auth0-specific fields to metadata for reference
  rawMetadata.auth0_user_id = user.user_id;
  rawMetadata.auth0_created_at = user.created_at;
  rawMetadata.auth0_updated_at = user.updated_at;

  // Include identities if available (for tracking connection types)
  if (user.identities && user.identities.length > 0) {
    rawMetadata.auth0_identities = user.identities.map(identity => ({
      provider: identity.provider,
      connection: identity.connection,
      isSocial: identity.isSocial
    }));
  }

  // Include login stats if available
  if (user.last_login) {
    rawMetadata.auth0_last_login = user.last_login;
  }
  if (user.logins_count !== undefined) {
    rawMetadata.auth0_logins_count = user.logins_count;
  }

  // Clean metadata for WorkOS compatibility
  const metadata = sanitizeMetadataForWorkOS(rawMetadata);

  // Build CSV row
  const csvRow: CSVRow = {
    email: user.email,
    first_name: firstName,
    last_name: lastName,
    email_verified: user.email_verified,
    external_id: user.user_id,
    metadata: Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : undefined,

    // Organization mapping
    // Use Auth0 org ID as WorkOS external_id
    org_external_id: org.id,
    org_name: org.display_name || org.name,

    // Password hash (optional - requires special Auth0 permission)
    password_hash: passwordHash?.hash,
    password_hash_type: passwordHash?.algorithm
      ? mapAuth0PasswordAlgorithm(passwordHash.algorithm)
      : undefined
  };

  return csvRow;
}

/**
 * Map Auth0 password algorithm to WorkOS format
 * WorkOS supports: bcrypt, md5, auth0 (for Auth0 hashes)
 */
function mapAuth0PasswordAlgorithm(algorithm: string): string {
  const lowerAlgorithm = algorithm.toLowerCase();

  // Auth0 uses 'bcrypt' which maps directly
  if (lowerAlgorithm.includes('bcrypt')) {
    return 'bcrypt';
  }

  // Auth0 uses 'md5' which maps directly
  if (lowerAlgorithm.includes('md5')) {
    return 'md5';
  }

  // For Auth0-specific hashing, use 'auth0' as type
  // WorkOS may support importing Auth0 hashes directly
  return 'auth0';
}

/**
 * Validate that a mapped row is ready for export
 * Returns null if valid, or an error message if invalid
 */
export function validateMappedRow(row: CSVRow): string | null {
  // Email is required
  if (!row.email || typeof row.email !== 'string' || row.email.trim() === '') {
    return 'Missing required field: email';
  }

  // Basic email format validation
  if (!row.email.includes('@')) {
    return `Invalid email format: ${row.email}`;
  }

  // Metadata must be valid JSON if present
  if (row.metadata) {
    try {
      JSON.parse(row.metadata as string);
    } catch {
      return 'Invalid metadata: must be valid JSON';
    }
  }

  return null;
}

/**
 * Extract organization information from Auth0 user metadata
 * Some Auth0 setups store org info in user metadata instead of using Auth0 Organizations
 * @param user Auth0 user object
 * @param customOrgIdField Custom field name for org ID (checked first)
 * @param customOrgNameField Custom field name for org name (checked first)
 */
export function extractOrgFromMetadata(
  user: Auth0User,
  customOrgIdField?: string,
  customOrgNameField?: string
): { orgId?: string; orgName?: string } | null {
  // Helper to check a metadata object for org fields
  const extractFromMetadata = (metadata: Record<string, unknown>) => {
    // Check custom fields first if provided
    let orgId: unknown;
    let orgName: unknown;

    if (customOrgIdField) {
      orgId = metadata[customOrgIdField];
    }

    if (customOrgNameField) {
      orgName = metadata[customOrgNameField];
    }

    // Fallback to default field names if custom fields not found
    if (!orgId) {
      orgId =
        metadata.organization_id ||
        metadata.org_id ||
        metadata.organizationId;
    }

    if (!orgName) {
      orgName =
        metadata.organization_name ||
        metadata.org_name ||
        metadata.organizationName;
    }

    if (orgId || orgName) {
      return {
        orgId: orgId ? String(orgId) : undefined,
        orgName: orgName ? String(orgName) : undefined
      };
    }

    return null;
  };

  // Check user_metadata first
  if (user.user_metadata) {
    const result = extractFromMetadata(user.user_metadata);
    if (result) return result;
  }

  // Check app_metadata as fallback
  if (user.app_metadata) {
    const result = extractFromMetadata(user.app_metadata);
    if (result) return result;
  }

  return null;
}
