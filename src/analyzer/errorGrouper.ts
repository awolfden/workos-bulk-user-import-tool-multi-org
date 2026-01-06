/**
 * Phase 4: Error Grouper
 *
 * Groups errors by normalized pattern, extracting common structures
 * from error messages while preserving semantic meaning.
 */

import crypto from 'node:crypto';
import type { ErrorRecord } from '../types.js';
import type { ErrorGroup } from './types.js';
import { classifyRetryability } from './retryClassifier.js';

/**
 * Normalize error message to extract pattern
 *
 * Replaces dynamic values with placeholders:
 * - Emails: <EMAIL>
 * - UUIDs: <UUID>
 * - Organization IDs: <ORG_ID>
 * - User IDs: <USER_ID>
 * - Numbers: <NUMBER>
 */
export function normalizeErrorMessage(message: string): string {
  let normalized = message;

  // Replace email addresses
  normalized = normalized.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '<EMAIL>');

  // Replace UUIDs (8-4-4-4-12 format)
  normalized = normalized.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<UUID>');

  // Replace WorkOS org IDs (org_...)
  normalized = normalized.replace(/\borg_[A-Za-z0-9]{20,}/g, '<ORG_ID>');

  // Replace WorkOS user IDs (user_...)
  normalized = normalized.replace(/\buser_[A-Za-z0-9]{20,}/g, '<USER_ID>');

  // Replace standalone numbers (but preserve "400", "500" etc in context)
  normalized = normalized.replace(/\b\d{5,}\b/g, '<NUMBER>');

  // Normalize whitespace
  normalized = normalized.replace(/\s+/g, ' ').trim();

  return normalized;
}

/**
 * Generate stable group ID from pattern + type + status
 */
export function generateGroupId(pattern: string, errorType?: string, httpStatus?: number): string {
  const key = `${errorType || 'unknown'}-${httpStatus || 'none'}-${pattern}`;
  return crypto.createHash('md5').update(key).digest('hex').substring(0, 12);
}

/**
 * Determine error severity
 */
export function determineSeverity(
  errorType?: string,
  httpStatus?: number,
  retryable?: boolean
): 'critical' | 'high' | 'medium' | 'low' {
  // Critical: Non-retryable validation errors (will block all imports)
  if (!retryable && (httpStatus === 400 || httpStatus === 422)) {
    return 'critical';
  }

  // Critical: Org resolution failures (will block entire org)
  if (errorType === 'org_resolution') {
    return 'critical';
  }

  // High: Conflicts (duplicates) - indicates data issues
  if (httpStatus === 409) {
    return 'high';
  }

  // Medium: Server errors (retryable but indicates API issues)
  if (httpStatus && httpStatus >= 500) {
    return 'medium';
  }

  // Low: Everything else
  return 'low';
}

/**
 * Group errors by pattern
 */
export function groupErrors(errors: ErrorRecord[]): ErrorGroup[] {
  const groups = new Map<string, {
    pattern: string;
    errorType?: string;
    httpStatus?: number;
    errors: ErrorRecord[];
    retryable: boolean;
    emails: Set<string>;
  }>();

  // First pass: group by normalized pattern
  for (const error of errors) {
    const pattern = normalizeErrorMessage(error.errorMessage);
    const groupId = generateGroupId(pattern, error.errorType, error.httpStatus);

    if (!groups.has(groupId)) {
      const classification = classifyRetryability(error);
      groups.set(groupId, {
        pattern,
        errorType: error.errorType,
        httpStatus: error.httpStatus,
        errors: [],
        retryable: classification.retryable,
        emails: new Set()
      });
    }

    const group = groups.get(groupId)!;
    group.errors.push(error);
    if (error.email) {
      group.emails.add(error.email);
    }
  }

  // Second pass: convert to ErrorGroup format
  const result: ErrorGroup[] = [];

  for (const [groupId, group] of groups.entries()) {
    const classification = classifyRetryability(group.errors[0]);
    const severity = determineSeverity(
      group.errorType,
      group.httpStatus,
      group.retryable
    );

    // Take first 3 errors as examples
    const examples = group.errors.slice(0, 3);

    // Take first 10 emails, then "and N more"
    const affectedEmails = Array.from(group.emails).slice(0, 10);

    result.push({
      id: groupId,
      pattern: group.pattern,
      errorType: group.errorType,
      httpStatus: group.httpStatus,
      count: group.errors.length,
      severity,
      retryable: group.retryable,
      retryStrategy: classification.strategy,
      examples,
      affectedEmails
    });
  }

  // Sort by severity, then count
  result.sort((a, b) => {
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
    if (severityDiff !== 0) return severityDiff;
    return b.count - a.count;
  });

  return result;
}
