/**
 * Phase 3: Field Mapper - Transformer Functions
 *
 * Registry of transformer functions for field transformations.
 * String-based lookup enables JSON profile configuration.
 */

import { parseBooleanLike, isBlank } from '../boolean.js';
import type { TransformerFunction } from './types.js';

/**
 * Transformer Registry
 *
 * Maps transformer names to functions for dynamic lookup.
 */
const TRANSFORMER_REGISTRY: Record<string, TransformerFunction> = {};

/**
 * Register a transformer function
 */
function registerTransformer(name: string, fn: TransformerFunction): void {
  TRANSFORMER_REGISTRY[name] = fn;
}

/**
 * Get a transformer by name
 *
 * @throws Error if transformer not found
 */
export function getTransformer(name: string): TransformerFunction {
  const transformer = TRANSFORMER_REGISTRY[name];
  if (!transformer) {
    throw new Error(`Unknown transformer: ${name}. Available: ${listTransformers().join(', ')}`);
  }
  return transformer;
}

/**
 * List all available transformers
 */
export function listTransformers(): string[] {
  return Object.keys(TRANSFORMER_REGISTRY).sort();
}

/**
 * Check if a transformer exists
 */
export function hasTransformer(name: string): boolean {
  return name in TRANSFORMER_REGISTRY;
}

// ============================================================================
// Built-in Transformers
// ============================================================================

/**
 * lowercase_trim: Convert to lowercase and trim whitespace
 *
 * Example: "  Alice@EXAMPLE.COM  " → "alice@example.com"
 */
registerTransformer('lowercase_trim', (value: unknown): string | undefined => {
  if (value === null || value === undefined) return undefined;
  const str = String(value);
  if (isBlank(str)) return undefined;
  return str.toLowerCase().trim();
});

/**
 * to_boolean: Convert various boolean representations to true/false string
 *
 * Example: "yes" → "true", "1" → "true", "no" → "false"
 */
registerTransformer('to_boolean', (value: unknown): string | undefined => {
  if (value === null || value === undefined) return undefined;
  const str = String(value);
  if (isBlank(str)) return undefined;
  const result = parseBooleanLike(str);
  return result !== undefined ? String(result) : undefined;
});

/**
 * to_json_string: Convert object to JSON string
 *
 * Example: {department: "Engineering"} → '{"department":"Engineering"}'
 */
registerTransformer('to_json_string', (value: unknown): string | undefined => {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string' && isBlank(value)) return undefined;

  // If already a JSON string, validate and return
  if (typeof value === 'string') {
    try {
      JSON.parse(value);
      return value;
    } catch {
      // Not valid JSON, stringify it
      return JSON.stringify(value);
    }
  }

  // Convert object to JSON
  return JSON.stringify(value);
});

/**
 * uppercase: Convert to uppercase
 *
 * Example: "hello" → "HELLO"
 */
registerTransformer('uppercase', (value: unknown): string | undefined => {
  if (value === null || value === undefined) return undefined;
  const str = String(value);
  if (isBlank(str)) return undefined;
  return str.toUpperCase();
});

/**
 * trim: Trim whitespace only
 *
 * Example: "  hello  " → "hello"
 */
registerTransformer('trim', (value: unknown): string | undefined => {
  if (value === null || value === undefined) return undefined;
  const str = String(value);
  if (isBlank(str)) return undefined;
  return str.trim();
});

/**
 * split_name: Split full name into first/last (special handling)
 *
 * Note: This transformer is intended for use in profiles that need to
 * split a single "name" field. It's not used for standard field mappings.
 *
 * Example: "Alice Smith" → {firstName: "Alice", lastName: "Smith"}
 */
registerTransformer('split_name', (value: unknown): string | undefined => {
  if (value === null || value === undefined) return undefined;
  const str = String(value).trim();
  if (isBlank(str)) return undefined;

  const parts = str.split(/\s+/);
  if (parts.length === 0) return undefined;
  if (parts.length === 1) return parts[0]; // Only first name

  // Return first name (caller should handle lastName separately)
  return parts[0];
});

/**
 * merge_metadata: Merge multiple metadata fields into one JSON object
 *
 * This is a special transformer used by MetadataMapping logic.
 * It merges multiple source fields into a single metadata JSON string.
 *
 * Example:
 *   user_metadata: '{"dept":"Eng"}'
 *   app_metadata: '{"role":"admin"}'
 *   → '{"dept":"Eng","role":"admin"}'
 */
registerTransformer('merge_metadata', (value: unknown, row: Record<string, unknown>): string | undefined => {
  // This transformer is called by MetadataMapping logic
  // The value parameter contains the merged metadata object
  if (!value || typeof value !== 'object') return undefined;

  const result = JSON.stringify(value);
  return result === '{}' ? undefined : result;
});

/**
 * identity: Pass through unchanged (useful for explicit no-op)
 *
 * Example: "hello" → "hello"
 */
registerTransformer('identity', (value: unknown): string | undefined => {
  if (value === null || value === undefined) return undefined;
  const str = String(value);
  if (isBlank(str)) return undefined;
  return str;
});
