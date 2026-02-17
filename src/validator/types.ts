/**
 * Phase 2: CSV Validator - Type Definitions
 *
 * Comprehensive type system for 3-pass CSV validation with auto-fix,
 * duplicate detection, and optional API conflict checking.
 */

import type { CSVRow } from '../types.js';

/**
 * Options for CSV validation
 */
export interface ValidationOptions {
  csvPath: string;
  autoFix?: boolean;
  fixedCsvPath?: string;
  reportPath?: string;
  checkApi?: boolean;
  dedupe?: boolean;
  dedupedCsvPath?: string;
  dedupeReportPath?: string;
  quiet?: boolean;
}

/**
 * Complete validation report with summary and issues
 */
export interface ValidationReport {
  summary: ValidationSummary;
  issues: ValidationIssue[];
  timestamp: string;
  csvHash: string;
}

/**
 * Summary statistics for validation run
 */
export interface ValidationSummary {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  warningRows: number;
  duplicateEmails: number;
  duplicateExternalIds: number;
  mode: 'single-org' | 'multi-org' | 'user-only';
  autoFixApplied: boolean;
  fixedIssues: number;
}

/**
 * Individual validation issue
 */
export interface ValidationIssue {
  severity: 'error' | 'warning' | 'info';
  category: 'header' | 'row' | 'duplicate' | 'api';
  recordNumber?: number;
  field?: string;
  email?: string;
  message: string;
  ruleId: string;
  autoFixed?: boolean;
  originalValue?: string;
  fixedValue?: string;
  orgId?: string;
  orgExternalId?: string;
}

/**
 * Context provided to validation rules
 */
export interface ValidationContext {
  headers?: string[];
  row?: CSVRow;
  recordNumber?: number;
  mode?: 'single-org' | 'multi-org' | 'user-only';
}

/**
 * Validation rule definition
 */
export interface ValidationRule {
  id: string;
  severity: 'error' | 'warning' | 'info';
  category: 'header' | 'row' | 'duplicate' | 'api';
  validate: (context: ValidationContext) => ValidationIssue[];
  autofix?: (row: CSVRow) => { fixed: CSVRow; changes: AutoFixChange[] };
}

/**
 * Auto-fix change tracking
 */
export interface AutoFixChange {
  field: string;
  originalValue: string;
  fixedValue: string;
  reason: string;
}

/**
 * Mode detection result
 */
export interface ModeDetection {
  mode: 'single-org' | 'multi-org' | 'user-only';
  hasOrgId: boolean;
  hasOrgExternalId: boolean;
  hasOrgName: boolean;
}
