/**
 * Phase 4: Retry Classifier
 *
 * Classifies errors as retryable or non-retryable based on HTTP status,
 * error type, and WorkOS error codes.
 */

import type { ErrorRecord } from '../types.js';
import type { RetryClassification, RetryStrategy } from './types.js';

/**
 * Classify if an error is retryable
 *
 * Decision tree prioritizes errorType-specific logic over generic HTTP status codes
 */
export function classifyRetryability(error: ErrorRecord): RetryClassification {
  // Case 1: Rate limiting (429) - always retryable with backoff (check first, universally applies)
  if (error.httpStatus === 429) {
    return {
      retryable: true,
      strategy: {
        type: 'with_backoff',
        reason: 'Rate limited - retry with exponential backoff',
        delayMs: 5000
      },
      reason: 'rate_limit'
    };
  }

  // Case 2: Organization resolution errors (check before generic status codes)
  if (error.errorType === 'org_resolution') {
    // Check if org was not found vs other error
    if (error.errorMessage.toLowerCase().includes('not found')) {
      return {
        retryable: false,
        reason: 'org_not_found'
      };
    }

    // Other org resolution errors might be retryable (network, API issues)
    if (!error.httpStatus || error.httpStatus >= 500) {
      return {
        retryable: true,
        strategy: {
          type: 'immediate',
          reason: 'Organization lookup failed - retry after service recovery'
        },
        reason: 'org_lookup_error'
      };
    }

    return {
      retryable: false,
      reason: 'org_resolution_error'
    };
  }

  // Case 3: Membership creation with existing userId (check before generic 409/500)
  // (user created, only membership failed)
  if (error.errorType === 'membership_create' && error.userId) {
    // If 409, duplicate membership - NOT retryable
    if (error.httpStatus === 409) {
      return {
        retryable: false,
        reason: 'membership_duplicate'
      };
    }

    // If 500+, retryable (user exists, membership failed temporarily)
    if (error.httpStatus && error.httpStatus >= 500) {
      return {
        retryable: true,
        strategy: {
          type: 'immediate',
          reason: 'Membership creation failed but user exists - retry membership only'
        },
        reason: 'membership_error_user_exists'
      };
    }

    // Other membership errors - check status
    if (error.httpStatus && error.httpStatus >= 400 && error.httpStatus < 500) {
      return {
        retryable: false,
        reason: 'membership_validation_error'
      };
    }
  }

  // Case 4: User creation errors (check before generic 400/409/500)
  if (error.errorType === 'user_create') {
    if (error.httpStatus && error.httpStatus >= 500) {
      return {
        retryable: true,
        strategy: {
          type: 'immediate',
          reason: 'User creation failed - retry after service recovery'
        },
        reason: 'user_create_server_error'
      };
    }

    if (error.httpStatus && error.httpStatus >= 400 && error.httpStatus < 500) {
      return {
        retryable: false,
        reason: 'user_create_validation_error'
      };
    }
  }

  // Case 5: Server errors (500+) - retryable immediately (generic fallback)
  if (error.httpStatus && error.httpStatus >= 500) {
    return {
      retryable: true,
      strategy: {
        type: 'immediate',
        reason: 'Server error - retry immediately after service recovery'
      },
      reason: 'server_error'
    };
  }

  // Case 6: Conflict errors (409) - NOT retryable (generic fallback)
  if (error.httpStatus === 409) {
    return {
      retryable: false,
      reason: 'conflict_duplicate'
    };
  }

  // Case 7: Validation errors (400, 422) - NOT retryable (generic fallback)
  if (error.httpStatus === 400 || error.httpStatus === 422) {
    return {
      retryable: false,
      reason: 'validation_error'
    };
  }

  // Case 8: No HTTP status - unknown error
  if (!error.httpStatus) {
    // Conservative: treat as retryable (might be network issue)
    return {
      retryable: true,
      strategy: {
        type: 'immediate',
        reason: 'Unknown error (no HTTP status) - retry with caution'
      },
      reason: 'unknown_error'
    };
  }

  // Default: not retryable
  return {
    retryable: false,
    reason: 'unknown_non_retryable'
  };
}

/**
 * Get human-readable retry strategy description
 */
export function getRetryStrategyDescription(strategy: RetryStrategy): string {
  switch (strategy.type) {
    case 'immediate':
      return 'Retry immediately';
    case 'with_backoff':
      return `Retry with ${strategy.delayMs}ms delay (exponential backoff recommended)`;
    case 'after_fix':
      return `Fix required: ${strategy.fixRequired}`;
    default:
      return 'Unknown retry strategy';
  }
}
