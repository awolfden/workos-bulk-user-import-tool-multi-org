/**
 * Configuration validation utilities
 * Validates exporter configuration for common mistakes and incompatible options
 */

import type { ExporterConfig } from './types.js';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate exporter configuration
 * Checks for invalid parameter combinations and missing required fields
 */
export function validateExporterConfig(config: ExporterConfig): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required fields
  if (!config.credentials) {
    errors.push('credentials is required');
  }

  if (!config.outputPath) {
    errors.push('outputPath is required');
  }

  // Performance constraints
  if (config.pageSize !== undefined) {
    if (config.pageSize < 1) {
      errors.push('pageSize must be at least 1');
    }
    if (config.pageSize > 100) {
      errors.push('pageSize cannot exceed 100 (Auth0 API limit)');
    }
  }

  // Metadata mode warnings
  if (config.useMetadata === false) {
    if (config.metadataOrgIdField) {
      warnings.push(
        'metadataOrgIdField is ignored when useMetadata is false (Organizations API mode)'
      );
    }
    if (config.metadataOrgNameField) {
      warnings.push(
        'metadataOrgNameField is ignored when useMetadata is false (Organizations API mode)'
      );
    }
  }

  // Organizations API mode warnings
  if (config.useMetadata === true) {
    if (config.organizationFilter) {
      warnings.push(
        'organizationFilter in metadata mode filters by metadata org IDs, not Auth0 org IDs'
      );
    }
  }

  // Custom metadata fields should be used together
  if (config.metadataOrgIdField && !config.metadataOrgNameField) {
    warnings.push(
      'metadataOrgIdField specified without metadataOrgNameField - consider specifying both for consistency'
    );
  }

  if (config.metadataOrgNameField && !config.metadataOrgIdField) {
    warnings.push(
      'metadataOrgNameField specified without metadataOrgIdField - consider specifying both for consistency'
    );
  }

  // Password export requires special permission
  if (config.includePasswordHashes) {
    warnings.push(
      'includePasswordHashes requires special Auth0 permission (read:user_idp_tokens scope). Export will continue if permission denied.'
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Get recommended configuration based on use case
 */
export function getRecommendedConfig(useCase: 'enterprise' | 'metadata' | 'filtered'): Partial<ExporterConfig> {
  switch (useCase) {
    case 'enterprise':
      return {
        useMetadata: false,
        pageSize: 100,
        includePasswordHashes: false
      };

    case 'metadata':
      return {
        useMetadata: true,
        pageSize: 100,
        includePasswordHashes: false
      };

    case 'filtered':
      return {
        useMetadata: false,
        pageSize: 100,
        organizationFilter: [] // User should populate this
      };

    default:
      return {};
  }
}
