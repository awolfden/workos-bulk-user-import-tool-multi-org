/**
 * Phase 3: Field Mapper - Profile Registry
 *
 * Loads mapping profiles from built-in definitions or custom JSON files.
 * Designed for easy extensibility - adding new profiles is trivial.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { MappingProfile, FieldMapping, MetadataMapping } from '../types.js';

/**
 * Built-in profile registry
 *
 * Maps profile names to their modules.
 * To add a new profile: create the file and add an entry here.
 */
const BUILT_IN_PROFILES: Record<string, () => Promise<{ default: MappingProfile }>> = {
  // Phase 3: Auth0 profile only
  'auth0': () => import('./auth0Profile.js'),

  // Future profiles (Phase 4+):
  // 'okta': () => import('./oktaProfile.js'),
  // 'cognito': () => import('./cognitoProfile.js'),
};

/**
 * Load a mapping profile by name or path
 *
 * @param nameOrPath - Built-in profile name (e.g., 'auth0') or path to JSON file
 * @returns Validated mapping profile
 * @throws Error if profile not found or invalid
 */
export async function loadProfile(nameOrPath: string): Promise<MappingProfile> {
  // Check if it's a built-in profile name
  if (nameOrPath in BUILT_IN_PROFILES) {
    const module = await BUILT_IN_PROFILES[nameOrPath]();
    return validateProfile(module.default);
  }

  // Try loading from file path
  if (fs.existsSync(nameOrPath)) {
    return loadProfileFromFile(nameOrPath);
  }

  // Not found
  throw new Error(
    `Profile not found: ${nameOrPath}\n` +
    `Available built-in profiles: ${listBuiltInProfiles().join(', ')}\n` +
    `Or provide a path to a custom JSON profile file.`
  );
}

/**
 * Load profile from JSON file
 */
function loadProfileFromFile(filePath: string): MappingProfile {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const profile = JSON.parse(content) as MappingProfile;
    return validateProfile(profile);
  } catch (error) {
    throw new Error(`Failed to load profile from ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Validate profile structure
 *
 * Ensures all required fields are present and valid.
 */
function validateProfile(profile: MappingProfile): MappingProfile {
  // Check required fields
  if (!profile.name) {
    throw new Error('Profile missing required field: name');
  }
  if (!profile.description) {
    throw new Error('Profile missing required field: description');
  }
  if (!Array.isArray(profile.mappings)) {
    throw new Error('Profile missing required field: mappings (must be array)');
  }

  // Validate each mapping
  for (let i = 0; i < profile.mappings.length; i++) {
    const mapping = profile.mappings[i];
    if (!mapping.sourceField) {
      throw new Error(`Mapping ${i} missing required field: sourceField`);
    }
    if (!mapping.targetField) {
      throw new Error(`Mapping ${i} missing required field: targetField`);
    }
  }

  // Validate metadata mapping if present
  if (profile.metadataMapping) {
    validateMetadataMapping(profile.metadataMapping);
  }

  return profile;
}

/**
 * Validate metadata mapping structure
 */
function validateMetadataMapping(mapping: MetadataMapping): void {
  if (mapping.targetField !== 'metadata') {
    throw new Error('MetadataMapping targetField must be "metadata"');
  }
  if (!Array.isArray(mapping.sourceFields) || mapping.sourceFields.length === 0) {
    throw new Error('MetadataMapping sourceFields must be non-empty array');
  }
}

/**
 * List all built-in profile names
 *
 * @returns Array of profile names
 */
export function listBuiltInProfiles(): string[] {
  return Object.keys(BUILT_IN_PROFILES).sort();
}

/**
 * Check if a profile name exists in built-in registry
 */
export function hasBuiltInProfile(name: string): boolean {
  return name in BUILT_IN_PROFILES;
}

/**
 * Get profile information without loading it
 *
 * Useful for CLI --list-profiles command.
 */
export async function getProfileInfo(name: string): Promise<{ name: string; description: string }> {
  if (!hasBuiltInProfile(name)) {
    throw new Error(`Profile not found: ${name}`);
  }

  const profile = await loadProfile(name);
  return {
    name: profile.name,
    description: profile.description
  };
}
