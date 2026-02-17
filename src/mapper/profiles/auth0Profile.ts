/**
 * Phase 3: Field Mapper - Auth0 Profile
 *
 * Transforms Auth0 user export format to WorkOS import format.
 *
 * Auth0 Export Format:
 *   - user_id, email, given_name, family_name, email_verified
 *   - user_metadata, app_metadata (separate JSON fields)
 *   - created_at, updated_at, last_login, logins_count, identities
 *
 * WorkOS Import Format:
 *   - email, first_name, last_name, email_verified, external_id
 *   - metadata (single merged JSON field)
 *   - org_external_id, org_name
 */

import type { MappingProfile } from '../types.js';

const auth0Profile: MappingProfile = {
  name: 'auth0',
  description: 'Auth0 user export to WorkOS format',

  /**
   * Field mappings
   *
   * Maps Auth0 columns to WorkOS columns with optional transformations.
   */
  mappings: [
    // Core user fields
    {
      sourceField: 'email',
      targetField: 'email',
      transformer: 'lowercase_trim'  // Normalize email
    },
    {
      sourceField: 'given_name',
      targetField: 'first_name',
      transformer: 'trim'
    },
    {
      sourceField: 'family_name',
      targetField: 'last_name',
      transformer: 'trim'
    },
    {
      sourceField: 'email_verified',
      targetField: 'email_verified',
      transformer: 'to_boolean'  // Convert various formats to true/false
    },
    {
      sourceField: 'user_id',
      targetField: 'external_id',
      transformer: 'trim'
    },

    // Organization fields
    // Note: Auth0 exports may have organization data embedded
    {
      sourceField: 'org_id',
      targetField: 'org_external_id',
      transformer: 'trim',
      skipIfBlank: true  // Only include if present
    },
    {
      sourceField: 'org_name',
      targetField: 'org_name',
      transformer: 'trim',
      skipIfBlank: true
    },

    // Password fields (optional - requires special Auth0 export)
    {
      sourceField: 'password_hash',
      targetField: 'password_hash',
      skipIfBlank: true
    },
    {
      sourceField: 'password_hash_type',
      targetField: 'password_hash_type',
      skipIfBlank: true
    }
  ],

  /**
   * Metadata mapping
   *
   * Auth0 has separate user_metadata and app_metadata fields.
   * Merge them into a single WorkOS metadata field with auth0_ prefix.
   */
  metadataMapping: {
    targetField: 'metadata',
    sourceFields: ['user_metadata', 'app_metadata'],
    fieldPrefix: 'auth0_',
    staticMetadata: {
      // Add provider identifier
      _provider: 'auth0'
    }
  },

  /**
   * Implementation notes
   */
  notes: [
    'Auth0 user_metadata and app_metadata are merged into WorkOS metadata',
    'Auth0-specific fields (user_id, created_at, updated_at) are preserved in metadata',
    'email_verified is normalized to true/false string',
    'Emails are normalized to lowercase',
    'Password hashes require special Auth0 export permission',
    'Organization fields (org_id, org_name) are optional'
  ]
};

export default auth0Profile;
