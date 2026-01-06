/**
 * Phase 3: Field Mapper - Type Definitions
 *
 * Complete type system for CSV field mapping between provider formats.
 */

import type { CSVRow } from '../types.js';

/**
 * Transformer function signature
 *
 * Pure function that transforms a value from source to target format.
 * Receives the value and entire row context for complex transformations.
 */
export type TransformerFunction = (
  value: unknown,
  row: Record<string, unknown>
) => string | boolean | undefined;

/**
 * Field mapping definition
 *
 * Defines how a single source field maps to a target field.
 */
export interface FieldMapping {
  sourceField: string;              // Source CSV column name
  targetField: string;              // Target WorkOS column name
  transformer?: string;             // Transformer name (registry lookup)
  defaultValue?: string | boolean;  // Default if source blank
  skipIfBlank?: boolean;            // Skip mapping if source value is blank
}

/**
 * Metadata mapping (many-to-one)
 *
 * Defines how multiple source fields merge into a single metadata JSON field.
 * Example: Auth0 user_metadata + app_metadata → WorkOS metadata
 */
export interface MetadataMapping {
  targetField: 'metadata';                    // Always 'metadata' for WorkOS
  sourceFields: string[];                     // Fields to merge (e.g., ['user_metadata', 'app_metadata'])
  fieldPrefix?: string;                       // Optional prefix for keys (e.g., 'auth0_')
  staticMetadata?: Record<string, string>;    // Static metadata to merge in
}

/**
 * Complete mapping profile
 *
 * Defines a complete transformation from one provider format to WorkOS format.
 * Can be loaded from built-in profiles or custom JSON files.
 */
export interface MappingProfile {
  name: string;                     // Profile identifier (e.g., 'auth0')
  description: string;              // Human-readable description
  mappings: FieldMapping[];         // Field-to-field mappings
  metadataMapping?: MetadataMapping; // Optional metadata merging
  notes?: string[];                 // Optional implementation notes
}

/**
 * Mapper options
 *
 * Configuration for field mapping operation.
 */
export interface MapperOptions {
  inputPath: string;                // Input CSV path
  outputPath: string;               // Output CSV path
  profile: MappingProfile;          // Mapping profile to use
  quiet?: boolean;                  // Suppress progress output
  validateAfter?: boolean;          // Run Phase 2 validator after mapping
}

/**
 * Mapping error
 *
 * Captures errors that occur during row transformation.
 */
export interface MappingError {
  recordNumber: number;                   // Row number where error occurred
  sourceRow: Record<string, unknown>;     // Original source row
  errorMessage: string;                   // Error description
  field?: string;                         // Field that caused error (if applicable)
}

/**
 * Mapping summary
 *
 * Results of field mapping operation.
 */
export interface MappingSummary {
  totalRows: number;                      // Total rows processed
  successfulRows: number;                 // Rows successfully transformed
  errorRows: number;                      // Rows with errors
  skippedFields: Record<string, number>;  // Unmapped source fields → count
  startedAt: number;                      // Start timestamp
  endedAt: number;                        // End timestamp
  durationMs: number;                     // Duration in milliseconds
  errors: MappingError[];                 // Detailed error list
}

/**
 * Auto-fix change
 *
 * Records a transformation applied during mapping.
 */
export interface AutoFixChange {
  field: string;              // Field name
  originalValue: string;      // Original value
  fixedValue: string;         // Transformed value
  reason: string;             // Transformation reason
}
