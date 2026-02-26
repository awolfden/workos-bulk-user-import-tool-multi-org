/**
 * Firebase to WorkOS field mapping
 * Transforms Firebase Auth JSON user records to WorkOS CSV format
 */

import type { CSVRow } from '../../types.js';
import { encodeFirebaseScryptPHC, type FirebaseScryptParams } from './phcEncoder.js';

/** Firebase Auth user record from JSON export */
export interface FirebaseUserRecord {
  localId: string;
  email?: string;
  emailVerified?: boolean;
  displayName?: string;
  photoUrl?: string;
  phoneNumber?: string;
  passwordHash?: string;
  salt?: string;
  disabled?: boolean;
  createdAt?: string;
  lastSignedInAt?: string;
  customAttributes?: string;
  providerUserInfo?: Array<{
    providerId: string;
    rawId: string;
    email?: string;
    displayName?: string;
    photoUrl?: string;
  }>;
  mfaInfo?: Array<{
    mfaEnrollmentId: string;
    displayName?: string;
    phoneInfo?: string;
    enrolledAt?: string;
  }>;
}

/** Name splitting strategy */
export type NameSplitStrategy = 'first-space' | 'last-space' | 'first-name-only';

/** Options for the Firebase mapper */
export interface FirebaseMapperOptions {
  nameSplitStrategy: NameSplitStrategy;
  scryptParams?: FirebaseScryptParams;
  includeDisabled?: boolean;
}

/** Org mapping row from user-provided CSV */
export interface FirebaseOrgMappingRow {
  firebase_uid: string;
  org_id?: string;
  org_external_id?: string;
  org_name?: string;
  [key: string]: string | undefined;
}

/** Result of mapping a single Firebase user */
export interface FirebaseMappingResult {
  row: CSVRow;
  warnings: string[];
  skipped: boolean;
  skipReason?: string;
}

/**
 * Split a display name into first and last name using the given strategy.
 */
export function splitDisplayName(
  displayName: string | undefined,
  strategy: NameSplitStrategy
): { firstName: string; lastName: string } {
  if (!displayName?.trim()) {
    return { firstName: '', lastName: '' };
  }

  const name = displayName.trim();

  switch (strategy) {
    case 'first-space': {
      const spaceIdx = name.indexOf(' ');
      if (spaceIdx === -1) return { firstName: name, lastName: '' };
      return {
        firstName: name.slice(0, spaceIdx),
        lastName: name.slice(spaceIdx + 1),
      };
    }
    case 'last-space': {
      const spaceIdx = name.lastIndexOf(' ');
      if (spaceIdx === -1) return { firstName: name, lastName: '' };
      return {
        firstName: name.slice(0, spaceIdx),
        lastName: name.slice(spaceIdx + 1),
      };
    }
    case 'first-name-only':
      return { firstName: name, lastName: '' };
    default:
      return { firstName: name, lastName: '' };
  }
}

/**
 * Convert millisecond epoch string to ISO 8601 date string.
 */
function msEpochToISO(msString: string): string | undefined {
  const ms = parseInt(msString, 10);
  if (isNaN(ms)) return undefined;
  return new Date(ms).toISOString();
}

/**
 * Map a Firebase user record to WorkOS CSV format
 */
export function mapFirebaseUserToWorkOS(
  user: FirebaseUserRecord,
  options: FirebaseMapperOptions,
  orgMapping?: FirebaseOrgMappingRow
): FirebaseMappingResult {
  const warnings: string[] = [];

  // Email is required
  const email = user.email?.trim();
  if (!email) {
    return {
      row: {} as CSVRow,
      warnings: [],
      skipped: true,
      skipReason: 'Missing email address',
    };
  }

  // Skip disabled users by default
  if (user.disabled && !options.includeDisabled) {
    return {
      row: {} as CSVRow,
      warnings: [],
      skipped: true,
      skipReason: 'User is disabled',
    };
  }

  // Split display name
  const { firstName, lastName } = splitDisplayName(user.displayName, options.nameSplitStrategy);

  // Map password hash
  let passwordHash: string | undefined;
  let passwordHashType: string | undefined;

  if (user.passwordHash && user.salt) {
    if (options.scryptParams) {
      passwordHash = encodeFirebaseScryptPHC(
        { passwordHash: user.passwordHash, salt: user.salt },
        options.scryptParams
      );
      passwordHashType = 'firebase-scrypt';
    } else {
      warnings.push(
        `No scrypt parameters provided for user ${user.localId} — password will not be migrated`
      );
    }
  }

  // Build metadata
  const metadata = buildFirebaseMetadata(user, options);

  // Build CSV row
  const csvRow: CSVRow = {
    email,
    first_name: firstName || undefined,
    last_name: lastName || undefined,
    email_verified: user.emailVerified === true ? 'true' : 'false',
    external_id: user.localId?.trim() || undefined,
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
 * Build metadata JSON from extra Firebase fields.
 * Only includes non-empty values.
 */
function buildFirebaseMetadata(
  user: FirebaseUserRecord,
  options: FirebaseMapperOptions
): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};

  // Always include firebase UID for cross-referencing
  if (user.localId?.trim()) {
    metadata.firebase_uid = user.localId.trim();
  }

  if (user.phoneNumber?.trim()) {
    metadata.phone_number = user.phoneNumber.trim();
  }

  if (user.photoUrl?.trim()) {
    metadata.photo_url = user.photoUrl.trim();
  }

  // Parse customAttributes JSON string
  if (user.customAttributes?.trim()) {
    try {
      metadata.custom_attributes = JSON.parse(user.customAttributes);
    } catch {
      // If invalid JSON, store as string
      metadata.custom_attributes = user.customAttributes.trim();
    }
  }

  if (user.providerUserInfo?.length) {
    metadata.provider_info = user.providerUserInfo;
  }

  if (user.mfaInfo?.length) {
    metadata.mfa_info = user.mfaInfo;
  }

  if (user.createdAt) {
    const iso = msEpochToISO(user.createdAt);
    if (iso) metadata.created_at = iso;
  }

  if (user.lastSignedInAt) {
    const iso = msEpochToISO(user.lastSignedInAt);
    if (iso) metadata.last_signed_in_at = iso;
  }

  // Include disabled flag in metadata when user is included despite being disabled
  if (user.disabled && options.includeDisabled) {
    metadata.disabled = true;
  }

  return metadata;
}

/**
 * Apply org mapping to a CSV row.
 * When org_id is present, only org_id is used.
 * When org_id is absent, pass through org_external_id and/or org_name.
 */
function applyOrgMapping(csvRow: CSVRow, orgMapping: FirebaseOrgMappingRow): void {
  const orgId = orgMapping.org_id?.trim();
  const orgExternalId = orgMapping.org_external_id?.trim();
  const orgName = orgMapping.org_name?.trim();

  if (orgId) {
    csvRow.org_id = orgId;
  } else {
    if (orgExternalId) {
      csvRow.org_external_id = orgExternalId;
    }
    if (orgName) {
      csvRow.org_name = orgName;
    }
  }
}
