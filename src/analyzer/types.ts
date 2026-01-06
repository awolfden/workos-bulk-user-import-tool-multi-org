/**
 * Phase 4: Error Analyzer - Type Definitions
 */

import type { ErrorRecord } from '../types.js';

/**
 * Options for error analysis
 */
export interface AnalyzerOptions {
  errorsPath: string;          // errors.jsonl file path
  retryCsvPath?: string;        // Optional: output retry CSV path
  reportPath?: string;          // Optional: JSON report path (default: error-analysis-report.json)
  includeDuplicates?: boolean;  // Include duplicate emails in retry CSV (default: false)
  quiet?: boolean;              // Suppress progress output
}

/**
 * Complete error analysis report
 */
export interface AnalysisReport {
  summary: AnalysisSummary;
  groups: ErrorGroup[];
  retryability: RetryabilitySummary;
  suggestions: FixSuggestion[];
  timestamp: string;
  errorsFile: string;
  errorsFileHash: string;
}

/**
 * Summary statistics
 */
export interface AnalysisSummary {
  totalErrors: number;
  retryableErrors: number;
  nonRetryableErrors: number;
  uniqueEmails: number;
  uniqueErrorPatterns: number;
  errorsByType: Record<string, number>;  // user_create: 123, membership_create: 45, ...
  errorsByStatus: Record<string, number>; // 400: 10, 409: 5, 500: 2, ...
}

/**
 * Retryability breakdown
 */
export interface RetryabilitySummary {
  retryable: {
    count: number;
    percentage: number;
    byReason: Record<string, number>;  // server_error: 10, rate_limit: 5, ...
  };
  nonRetryable: {
    count: number;
    percentage: number;
    byReason: Record<string, number>;  // validation_error: 20, conflict: 15, ...
  };
}

/**
 * Error group (by pattern)
 */
export interface ErrorGroup {
  id: string;                    // Unique group ID (hash of pattern)
  pattern: string;               // Normalized error message pattern
  errorType?: string;            // user_create | membership_create | org_resolution
  httpStatus?: number;           // HTTP status code (if applicable)
  count: number;                 // Number of errors in this group
  severity: 'critical' | 'high' | 'medium' | 'low';
  retryable: boolean;            // Is this group retryable?
  retryStrategy?: RetryStrategy; // How to retry (if retryable)
  examples: ErrorRecord[];       // Sample errors (max 3)
  affectedEmails: string[];      // List of affected emails (max 10, then "and N more")
}

/**
 * Retry strategy
 */
export interface RetryStrategy {
  type: 'immediate' | 'with_backoff' | 'after_fix';
  reason: string;                // Human-readable reason
  delayMs?: number;              // Suggested delay for backoff
  fixRequired?: string;          // What needs to be fixed first
}

/**
 * Fix suggestion
 */
export interface FixSuggestion {
  groupId: string;               // References ErrorGroup.id
  pattern: string;               // Error pattern this applies to
  severity: 'critical' | 'high' | 'medium' | 'low';
  affectedCount: number;         // Number of errors affected
  suggestion: string;            // Human-readable fix suggestion
  actionable: boolean;           // Can be fixed in CSV? (vs API/config change)
  exampleFix?: string;           // Example of how to fix (for CSV issues)
}

/**
 * Retryable error (extracted for CSV)
 */
export interface RetryableError {
  email: string;
  rawRow: Record<string, unknown>;
  errorRecord: ErrorRecord;
}

/**
 * Retry classification result
 */
export interface RetryClassification {
  retryable: boolean;
  strategy?: RetryStrategy;
  reason: string;                // Why retryable/not retryable
}
