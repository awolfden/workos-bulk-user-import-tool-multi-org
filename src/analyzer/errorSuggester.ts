/**
 * Phase 4: Error Suggester
 *
 * Generates actionable fix suggestions based on error patterns.
 */

import type { ErrorGroup, FixSuggestion } from './types.js';

/**
 * Generate fix suggestions from error groups
 */
export function generateSuggestions(groups: ErrorGroup[]): FixSuggestion[] {
  const suggestions: FixSuggestion[] = [];

  for (const group of groups) {
    const suggestion = generateSuggestionForGroup(group);
    if (suggestion) {
      suggestions.push(suggestion);
    }
  }

  return suggestions;
}

/**
 * Generate suggestion for a single error group
 */
function generateSuggestionForGroup(group: ErrorGroup): FixSuggestion | null {
  const pattern = group.pattern.toLowerCase();
  const { errorType, httpStatus, count, severity, id } = group;

  // Pattern 1: Invalid email format
  if (pattern.includes('invalid email') || pattern.includes('email format')) {
    return {
      groupId: id,
      pattern: group.pattern,
      severity,
      affectedCount: count,
      suggestion: 'Fix email addresses in CSV. Ensure all emails match pattern: name@domain.com',
      actionable: true,
      exampleFix: 'Change "john.doe" to "john.doe@example.com"'
    };
  }

  // Pattern 2: Missing required field
  if (pattern.includes('missing required') || pattern.includes('required field')) {
    return {
      groupId: id,
      pattern: group.pattern,
      severity,
      affectedCount: count,
      suggestion: 'Add missing required fields to CSV rows. Check validation report for details.',
      actionable: true,
      exampleFix: 'Add email column or fill empty email cells'
    };
  }

  // Pattern 3: Duplicate user (409)
  if (httpStatus === 409 && errorType === 'user_create') {
    return {
      groupId: id,
      pattern: group.pattern,
      severity,
      affectedCount: count,
      suggestion: 'Users already exist in WorkOS. Remove duplicates from CSV or skip these rows.',
      actionable: true,
      exampleFix: 'Remove rows with emails that already exist in WorkOS'
    };
  }

  // Pattern 4: Duplicate membership (409)
  if (httpStatus === 409 && errorType === 'membership_create') {
    return {
      groupId: id,
      pattern: group.pattern,
      severity,
      affectedCount: count,
      suggestion: 'Memberships already exist. Remove duplicate org_id/user combinations.',
      actionable: true,
      exampleFix: 'Ensure each user-org pair appears only once in CSV'
    };
  }

  // Pattern 5: Organization not found
  if (errorType === 'org_resolution' && pattern.includes('not found')) {
    return {
      groupId: id,
      pattern: group.pattern,
      severity,
      affectedCount: count,
      suggestion: 'Organizations not found in WorkOS. Verify org_id/org_external_id values or add org_name to create missing orgs.',
      actionable: true,
      exampleFix: 'Add org_name column with organization names to auto-create missing orgs'
    };
  }

  // Pattern 6: Invalid JSON in metadata
  if (pattern.includes('invalid json') || pattern.includes('json')) {
    return {
      groupId: id,
      pattern: group.pattern,
      severity,
      affectedCount: count,
      suggestion: 'Fix malformed JSON in metadata column. Ensure proper JSON formatting.',
      actionable: true,
      exampleFix: 'Change {"key":"value} to {"key":"value"} (close quotes)'
    };
  }

  // Pattern 7: Password hash incomplete
  if (pattern.includes('password_hash') && pattern.includes('type')) {
    return {
      groupId: id,
      pattern: group.pattern,
      severity,
      affectedCount: count,
      suggestion: 'Add password_hash_type column (e.g., "bcrypt") for rows with password_hash.',
      actionable: true,
      exampleFix: 'Add password_hash_type column with value "bcrypt"'
    };
  }

  // Pattern 8: Rate limiting (429)
  if (httpStatus === 429) {
    return {
      groupId: id,
      pattern: group.pattern,
      severity,
      affectedCount: count,
      suggestion: 'Rate limited by WorkOS API. Reduce --concurrency value (try 5 or lower) and retry.',
      actionable: false,
      exampleFix: 'Run: npx tsx bin/import-users.ts --csv retry.csv --concurrency 5'
    };
  }

  // Pattern 9: Server errors (500+)
  if (httpStatus && httpStatus >= 500) {
    return {
      groupId: id,
      pattern: group.pattern,
      severity,
      affectedCount: count,
      suggestion: 'WorkOS API server error. Wait a few minutes and retry with generated retry CSV.',
      actionable: false,
      exampleFix: 'Wait 5-10 minutes, then run: npx tsx bin/import-users.ts --csv retry.csv'
    };
  }

  // Pattern 10: Validation errors (400, 422)
  if (httpStatus === 400 || httpStatus === 422) {
    return {
      groupId: id,
      pattern: group.pattern,
      severity,
      affectedCount: count,
      suggestion: 'Validation error from WorkOS API. Review error message and fix data in CSV.',
      actionable: true,
      exampleFix: 'Check error examples in report for specific field issues'
    };
  }

  // Default: no specific suggestion
  return null;
}
