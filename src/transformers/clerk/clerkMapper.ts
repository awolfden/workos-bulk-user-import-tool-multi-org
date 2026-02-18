/**
 * Clerk to WorkOS field mapping
 * Transforms Clerk CSV export rows to WorkOS CSV format
 */

import type { CSVRow } from '../../types.js';

/** Raw row from Clerk CSV export */
export interface ClerkUserRow {
  id: string;
  first_name: string;
  last_name: string;
  username: string;
  primary_email_address: string;
  primary_phone_number: string;
  verified_email_addresses: string;
  unverified_email_addresses: string;
  verified_phone_numbers: string;
  unverified_phone_numbers: string;
  totp_secret: string;
  password_digest: string;
  password_hasher: string;
  [key: string]: string;
}

/** Org mapping row from user-provided CSV */
export interface OrgMappingRow {
  clerk_user_id: string;
  org_id?: string;
  org_external_id?: string;
  org_name?: string;
  [key: string]: string | undefined;
}

/** Result of mapping a single Clerk user */
export interface ClerkMappingResult {
  row: CSVRow;
  warnings: string[];
  skipped: boolean;
  skipReason?: string;
}

/**
 * Map a Clerk CSV row to WorkOS CSV format
 *
 * @param clerkRow Raw row from Clerk CSV export
 * @param orgMapping Optional org mapping entry for this user
 * @returns Mapping result with WorkOS CSV row, warnings, and skip status
 */
export function mapClerkUserToWorkOS(
  clerkRow: ClerkUserRow,
  orgMapping?: OrgMappingRow
): ClerkMappingResult {
  const warnings: string[] = [];

  // Email is required
  const email = clerkRow.primary_email_address?.trim();
  if (!email) {
    return {
      row: {} as CSVRow,
      warnings: [],
      skipped: true,
      skipReason: 'Missing required field: primary_email_address',
    };
  }

  // Map password hash (bcrypt only)
  let passwordHash: string | undefined;
  let passwordHashType: string | undefined;

  const hasher = clerkRow.password_hasher?.trim().toLowerCase();
  const digest = clerkRow.password_digest?.trim();

  if (digest && hasher) {
    if (hasher === 'bcrypt') {
      passwordHash = digest;
      passwordHashType = 'bcrypt';
    } else {
      warnings.push(
        `Unsupported password hasher "${clerkRow.password_hasher}" for user ${clerkRow.id} — password will not be migrated`
      );
    }
  }

  // Build metadata from extra Clerk fields
  const metadata = buildClerkMetadata(clerkRow);

  // Build base CSV row
  const csvRow: CSVRow = {
    email,
    first_name: clerkRow.first_name?.trim() || undefined,
    last_name: clerkRow.last_name?.trim() || undefined,
    email_verified: 'true',
    external_id: clerkRow.id?.trim() || undefined,
    password_hash: passwordHash,
    password_hash_type: passwordHashType,
    metadata: Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : undefined,
  };

  // Apply org mapping if provided
  if (orgMapping) {
    applyOrgMapping(csvRow, orgMapping);
  }

  return { row: csvRow, warnings, skipped: false };
}

/**
 * Build metadata JSON from extra Clerk fields
 * Collects fields that don't have a direct WorkOS equivalent into metadata.
 * Filters out empty values.
 */
function buildClerkMetadata(clerkRow: ClerkUserRow): Record<string, string> {
  const metadata: Record<string, string> = {};

  // Always include clerk user ID for cross-referencing
  if (clerkRow.id?.trim()) {
    metadata.clerk_user_id = clerkRow.id.trim();
  }

  // Username
  if (clerkRow.username?.trim()) {
    metadata.username = clerkRow.username.trim();
  }

  // Phone numbers
  if (clerkRow.primary_phone_number?.trim()) {
    metadata.primary_phone_number = clerkRow.primary_phone_number.trim();
  }
  if (clerkRow.verified_phone_numbers?.trim()) {
    metadata.verified_phone_numbers = clerkRow.verified_phone_numbers.trim();
  }
  if (clerkRow.unverified_phone_numbers?.trim()) {
    metadata.unverified_phone_numbers = clerkRow.unverified_phone_numbers.trim();
  }

  // Email lists (verified/unverified)
  if (clerkRow.verified_email_addresses?.trim()) {
    metadata.verified_email_addresses = clerkRow.verified_email_addresses.trim();
  }
  if (clerkRow.unverified_email_addresses?.trim()) {
    metadata.unverified_email_addresses = clerkRow.unverified_email_addresses.trim();
  }

  // TOTP secret
  if (clerkRow.totp_secret?.trim()) {
    metadata.totp_secret = clerkRow.totp_secret.trim();
  }

  return metadata;
}

/**
 * Apply org mapping to a CSV row
 * When org_id is present, only org_id is used (org already exists in WorkOS).
 * When org_id is absent, pass through org_external_id and/or org_name.
 */
function applyOrgMapping(csvRow: CSVRow, orgMapping: OrgMappingRow): void {
  const orgId = orgMapping.org_id?.trim();
  const orgExternalId = orgMapping.org_external_id?.trim();
  const orgName = orgMapping.org_name?.trim();

  if (orgId) {
    // org_id takes priority — org already exists
    csvRow.org_id = orgId;
  } else {
    // Pass through whichever columns are available
    if (orgExternalId) {
      csvRow.org_external_id = orgExternalId;
    }
    if (orgName) {
      csvRow.org_name = orgName;
    }
  }
}
