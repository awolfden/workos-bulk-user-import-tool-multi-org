/**
 * Phase 2: Validation Rules Registry
 *
 * Comprehensive rule set for CSV validation:
 * - 3 header rules
 * - 7 row rules (2 with auto-fix)
 * - 2 duplicate rules
 * - 3 API rules (optional)
 */

import { KNOWN_COLUMNS } from '../importer.js';
import { parseBooleanLike, isBlank } from '../boolean.js';
import type { ValidationRule, ValidationContext, ValidationIssue, AutoFixChange } from './types.js';
import type { CSVRow } from '../types.js';

/**
 * Header Rules (Pass 1)
 */

/** Rule 1: Email column is required */
const requiredEmailColumn: ValidationRule = {
  id: 'required-email-column',
  severity: 'error',
  category: 'header',
  validate: (context: ValidationContext): ValidationIssue[] => {
    const { headers } = context;
    if (!headers || !headers.includes('email')) {
      return [{
        severity: 'error',
        category: 'header',
        message: 'Missing required column: email',
        ruleId: 'required-email-column'
      }];
    }
    return [];
  }
};

/** Rule 2: Warn about unknown columns */
const unknownColumns: ValidationRule = {
  id: 'unknown-columns',
  severity: 'warning',
  category: 'header',
  validate: (context: ValidationContext): ValidationIssue[] => {
    const { headers } = context;
    if (!headers) return [];

    const issues: ValidationIssue[] = [];
    for (const header of headers) {
      if (!KNOWN_COLUMNS.has(header)) {
        issues.push({
          severity: 'warning',
          category: 'header',
          field: header,
          message: `Unknown column: ${header}`,
          ruleId: 'unknown-columns'
        });
      }
    }
    return issues;
  }
};

/** Rule 3: Detect import mode from headers */
const modeDetection: ValidationRule = {
  id: 'mode-detection',
  severity: 'info',
  category: 'header',
  validate: (context: ValidationContext): ValidationIssue[] => {
    const { headers } = context;
    if (!headers) return [];

    const hasOrgId = headers.includes('org_id');
    const hasOrgExternalId = headers.includes('org_external_id');
    const hasOrgName = headers.includes('org_name');

    let mode: 'single-org' | 'multi-org' | 'user-only';
    if (hasOrgId || hasOrgExternalId || hasOrgName) {
      mode = 'multi-org';
    } else {
      mode = 'user-only';
    }

    return [{
      severity: 'info',
      category: 'header',
      message: `Detected mode: ${mode}`,
      ruleId: 'mode-detection'
    }];
  }
};

/**
 * Row Rules (Pass 2)
 */

/** Rule 4: Email is required */
const requiredEmail: ValidationRule = {
  id: 'required-email',
  severity: 'error',
  category: 'row',
  validate: (context: ValidationContext): ValidationIssue[] => {
    const { row, recordNumber } = context;
    if (!row) return [];

    const email = typeof row.email === 'string' ? row.email.trim() : '';
    if (!email || isBlank(email)) {
      return [{
        severity: 'error',
        category: 'row',
        recordNumber,
        field: 'email',
        message: 'Missing required email',
        ruleId: 'required-email'
      }];
    }
    return [];
  }
};

/** Rule 5: Email must contain @ */
const emailFormat: ValidationRule = {
  id: 'email-format',
  severity: 'error',
  category: 'row',
  validate: (context: ValidationContext): ValidationIssue[] => {
    const { row, recordNumber } = context;
    if (!row) return [];

    const email = typeof row.email === 'string' ? row.email.trim() : '';
    if (email && !email.includes('@')) {
      return [{
        severity: 'error',
        category: 'row',
        recordNumber,
        field: 'email',
        email,
        message: `Invalid email format: ${email}`,
        ruleId: 'email-format'
      }];
    }
    return [];
  }
};

/** Rule 6: Email should not have whitespace (AUTO-FIX) */
const emailWhitespace: ValidationRule = {
  id: 'email-whitespace',
  severity: 'warning',
  category: 'row',
  validate: (context: ValidationContext): ValidationIssue[] => {
    const { row, recordNumber } = context;
    if (!row || !row.email) return [];

    const email = String(row.email);
    if (email !== email.trim()) {
      return [{
        severity: 'warning',
        category: 'row',
        recordNumber,
        field: 'email',
        email: email.trim(),
        message: `Email has whitespace: "${email}"`,
        ruleId: 'email-whitespace',
        originalValue: email,
        fixedValue: email.trim()
      }];
    }
    return [];
  },
  autofix: (row: CSVRow) => {
    const changes: AutoFixChange[] = [];
    if (row.email) {
      const original = String(row.email);
      const fixed = original.trim();
      if (original !== fixed) {
        changes.push({
          field: 'email',
          originalValue: original,
          fixedValue: fixed,
          reason: 'Removed whitespace from email'
        });
        row.email = fixed;
      }
    }
    return { fixed: row, changes };
  }
};

/** Rule 7: Metadata must be valid JSON if present */
const metadataJson: ValidationRule = {
  id: 'metadata-json',
  severity: 'error',
  category: 'row',
  validate: (context: ValidationContext): ValidationIssue[] => {
    const { row, recordNumber } = context;
    if (!row || !row.metadata) return [];

    const metadata = typeof row.metadata === 'string' ? row.metadata.trim() : '';
    if (metadata.length > 0) {
      try {
        JSON.parse(metadata);
      } catch (err) {
        return [{
          severity: 'error',
          category: 'row',
          recordNumber,
          field: 'metadata',
          email: String(row.email || ''),
          message: `Invalid JSON in metadata field: ${(err as Error).message}`,
          ruleId: 'metadata-json'
        }];
      }
    }
    return [];
  }
};

/** Rule 7b: Metadata arrays/objects should be stringified (WorkOS limitation) */
const metadataArraysObjects: ValidationRule = {
  id: 'metadata-arrays-objects',
  severity: 'warning',
  category: 'row',
  validate: (context: ValidationContext): ValidationIssue[] => {
    const { row, recordNumber } = context;
    if (!row || !row.metadata) return [];

    const metadata = typeof row.metadata === 'string' ? row.metadata.trim() : '';
    if (metadata.length > 0) {
      try {
        const parsed = JSON.parse(metadata);
        const issues: ValidationIssue[] = [];

        for (const [key, value] of Object.entries(parsed)) {
          if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
            issues.push({
              severity: 'warning',
              category: 'row',
              recordNumber,
              field: 'metadata',
              email: String(row.email || ''),
              message: `Metadata field "${key}" contains array/object (will be auto-converted to JSON string for WorkOS compatibility)`,
              ruleId: 'metadata-arrays-objects',
              originalValue: String(value),
              fixedValue: JSON.stringify(value)
            });
          }
        }
        return issues;
      } catch {
        // If JSON is invalid, the metadata-json rule will catch it
        return [];
      }
    }
    return [];
  },
  autofix: (row: CSVRow) => {
    const changes: AutoFixChange[] = [];
    if (row.metadata) {
      const metadata = typeof row.metadata === 'string' ? row.metadata.trim() : '';
      if (metadata.length > 0) {
        try {
          const parsed = JSON.parse(metadata);
          let hasChanges = false;
          const fixed: Record<string, unknown> = {};

          for (const [key, value] of Object.entries(parsed)) {
            if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
              // Convert arrays and objects to JSON strings
              const stringified = JSON.stringify(value);
              fixed[key] = stringified;
              hasChanges = true;
              changes.push({
                field: `metadata.${key}`,
                originalValue: String(value),
                fixedValue: stringified,
                reason: 'Converted array/object to JSON string for WorkOS compatibility'
              });
            } else {
              // Keep primitives as-is
              fixed[key] = value;
            }
          }

          if (hasChanges) {
            row.metadata = JSON.stringify(fixed);
          }
        } catch {
          // If JSON is invalid, don't try to fix
        }
      }
    }
    return { fixed: row, changes };
  }
};

/** Rule 8: org_id and org_external_id are mutually exclusive */
const orgIdConflict: ValidationRule = {
  id: 'org-id-conflict',
  severity: 'error',
  category: 'row',
  validate: (context: ValidationContext): ValidationIssue[] => {
    const { row, recordNumber } = context;
    if (!row) return [];

    const hasOrgId = row.org_id && !isBlank(String(row.org_id));
    const hasOrgExternalId = row.org_external_id && !isBlank(String(row.org_external_id));

    if (hasOrgId && hasOrgExternalId) {
      return [{
        severity: 'error',
        category: 'row',
        recordNumber,
        email: String(row.email || ''),
        message: 'Row has both org_id and org_external_id - these are mutually exclusive',
        ruleId: 'org-id-conflict',
        orgId: String(row.org_id),
        orgExternalId: String(row.org_external_id)
      }];
    }
    return [];
  }
};

/** Rule 9: Boolean fields should be valid boolean-like values (AUTO-FIX) */
const booleanFormat: ValidationRule = {
  id: 'boolean-format',
  severity: 'warning',
  category: 'row',
  validate: (context: ValidationContext): ValidationIssue[] => {
    const { row, recordNumber } = context;
    if (!row || !row.email_verified) return [];

    const value = String(row.email_verified);
    const parsed = parseBooleanLike(value);

    // If parseBooleanLike returns undefined, it's an invalid boolean
    if (parsed === undefined && !isBlank(value)) {
      return [{
        severity: 'warning',
        category: 'row',
        recordNumber,
        field: 'email_verified',
        email: String(row.email || ''),
        message: `Invalid boolean value: "${value}" (expected: true/false/1/0/yes/no/y/n)`,
        ruleId: 'boolean-format',
        originalValue: value,
        fixedValue: 'false'
      }];
    }
    return [];
  },
  autofix: (row: CSVRow) => {
    const changes: AutoFixChange[] = [];
    if (row.email_verified) {
      const original = String(row.email_verified);
      const parsed = parseBooleanLike(original);

      if (parsed === undefined && !isBlank(original)) {
        // Invalid boolean - default to false
        changes.push({
          field: 'email_verified',
          originalValue: original,
          fixedValue: 'false',
          reason: 'Invalid boolean value, defaulted to false'
        });
        row.email_verified = 'false';
      } else if (parsed !== undefined) {
        // Valid but normalize to 'true' or 'false'
        const normalized = String(parsed);
        if (original !== normalized) {
          changes.push({
            field: 'email_verified',
            originalValue: original,
            fixedValue: normalized,
            reason: 'Normalized boolean value'
          });
          row.email_verified = normalized;
        }
      }
    }
    return { fixed: row, changes };
  }
};

/** Rule 10: role_slugs format validation */
const roleSlugsFormat: ValidationRule = {
  id: 'role-slugs-format',
  severity: 'error',
  category: 'row',
  validate: (context: ValidationContext): ValidationIssue[] => {
    const { row, recordNumber } = context;
    if (!row || row.role_slugs === undefined || row.role_slugs === null) return [];

    const raw = String(row.role_slugs).trim();
    if (!raw) {
      return [{
        severity: 'warning',
        category: 'row',
        recordNumber,
        field: 'role_slugs',
        email: String(row.email || ''),
        message: 'role_slugs column is present but empty',
        ruleId: 'role-slugs-format'
      }];
    }

    // Parse role slugs (try JSON array first, then comma-separated)
    let slugs: string[];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        slugs = parsed.map((s: unknown) => String(s).trim()).filter(Boolean);
      } else {
        slugs = raw.split(',').map(s => s.trim()).filter(Boolean);
      }
    } catch {
      slugs = raw.split(',').map(s => s.trim()).filter(Boolean);
    }

    const issues: ValidationIssue[] = [];
    for (const slug of slugs) {
      if (!/^[a-z0-9_-]+$/.test(slug)) {
        issues.push({
          severity: 'error',
          category: 'row',
          recordNumber,
          field: 'role_slugs',
          email: String(row.email || ''),
          message: `Invalid role slug "${slug}" — must be lowercase alphanumeric with hyphens/underscores`,
          ruleId: 'role-slugs-format'
        });
      }
    }

    return issues;
  }
};

/** Rule 11: password_hash requires password_hash_type */
const passwordHashComplete: ValidationRule = {
  id: 'password-hash-complete',
  severity: 'error',
  category: 'row',
  validate: (context: ValidationContext): ValidationIssue[] => {
    const { row, recordNumber } = context;
    if (!row) return [];

    const hasHash = row.password_hash && !isBlank(String(row.password_hash));
    const hasType = row.password_hash_type && !isBlank(String(row.password_hash_type));

    if (hasHash && !hasType) {
      return [{
        severity: 'error',
        category: 'row',
        recordNumber,
        field: 'password_hash',
        email: String(row.email || ''),
        message: 'password_hash provided without password_hash_type',
        ruleId: 'password-hash-complete'
      }];
    }
    return [];
  }
};

/**
 * Duplicate Rules (Pass 2 - checked during streaming)
 * Note: These are validated externally by DuplicateDetector, not via the rule system
 */

/**
 * API Rules (Pass 3 - optional)
 * Note: These are implemented in apiChecker.ts, not here
 */

/**
 * Export all rules as registry
 */
export const HEADER_RULES: ValidationRule[] = [
  requiredEmailColumn,
  unknownColumns,
  modeDetection
];

export const ROW_RULES: ValidationRule[] = [
  requiredEmail,
  emailFormat,
  emailWhitespace,
  metadataJson,
  metadataArraysObjects,
  orgIdConflict,
  booleanFormat,
  roleSlugsFormat,
  passwordHashComplete
];

export const ALL_RULES: ValidationRule[] = [
  ...HEADER_RULES,
  ...ROW_RULES
];

/**
 * Get rules by category
 */
export function getRulesByCategory(category: 'header' | 'row' | 'duplicate' | 'api'): ValidationRule[] {
  return ALL_RULES.filter(rule => rule.category === category);
}

/**
 * Get rule by ID
 */
export function getRuleById(id: string): ValidationRule | undefined {
  return ALL_RULES.find(rule => rule.id === id);
}

/**
 * Get rules with auto-fix capability
 */
export function getAutoFixRules(): ValidationRule[] {
  return ALL_RULES.filter(rule => rule.autofix !== undefined);
}
