#!/usr/bin/env tsx
/**
 * Tests for Auth0 exporter
 * Tests field mapping, validation, and CSV generation
 */

import assert from 'node:assert';
import { mapAuth0UserToWorkOS, validateMappedRow, extractOrgFromMetadata } from './auth0Mapper.js';
import type { Auth0User, Auth0Organization } from '../types.js';

async function main() {
  console.log('Testing Auth0 Exporter...\n');

  // Test 1: Basic field mapping
  console.log('Test 1: Basic field mapping');
  const testUser: Auth0User = {
    user_id: 'auth0|123456',
    email: 'test@example.com',
    email_verified: true,
    given_name: 'Test',
    family_name: 'User',
    name: 'Test User',
    user_metadata: { department: 'Engineering' },
    app_metadata: { role: 'Developer' },
    created_at: '2024-01-15T10:30:00.000Z',
    updated_at: '2024-12-01T14:22:33.000Z'
  };

  const testOrg: Auth0Organization = {
    id: 'org_abc123',
    name: 'Acme Corporation',
    display_name: 'Acme Corp'
  };

  const csvRow = mapAuth0UserToWorkOS(testUser, testOrg);

  assert.strictEqual(csvRow.email, 'test@example.com', 'Email should match');
  assert.strictEqual(csvRow.first_name, 'Test', 'First name should match');
  assert.strictEqual(csvRow.last_name, 'User', 'Last name should match');
  assert.strictEqual(csvRow.email_verified, true, 'Email verified should match');
  assert.strictEqual(csvRow.external_id, 'auth0|123456', 'External ID should be Auth0 user_id');
  assert.strictEqual(csvRow.org_external_id, 'org_abc123', 'Org external ID should be Auth0 org ID');
  assert.strictEqual(csvRow.org_name, 'Acme Corp', 'Org name should use display_name');

  // Check metadata merging
  const metadata = JSON.parse(csvRow.metadata as string);
  assert.strictEqual(metadata.department, 'Engineering', 'Should include user_metadata');
  assert.strictEqual(metadata.role, 'Developer', 'Should include app_metadata');
  assert.strictEqual(metadata.auth0_user_id, 'auth0|123456', 'Should include Auth0 user ID');

  console.log('✓ Passed\n');

  // Test 2: Name parsing fallback
  console.log('Test 2: Name parsing from full name');
  const userWithoutNames: Auth0User = {
    user_id: 'auth0|234567',
    email: 'john.doe@example.com',
    email_verified: true,
    name: 'John Doe',
    created_at: '2024-01-15T10:30:00.000Z',
    updated_at: '2024-12-01T14:22:33.000Z'
  };

  const csvRow2 = mapAuth0UserToWorkOS(userWithoutNames, testOrg);

  assert.strictEqual(csvRow2.first_name, 'John', 'Should parse first name from full name');
  assert.strictEqual(csvRow2.last_name, 'Doe', 'Should parse last name from full name');

  console.log('✓ Passed\n');

  // Test 3: Validation - valid row
  console.log('Test 3: Validation - valid row');
  const validationError1 = validateMappedRow(csvRow);
  assert.strictEqual(validationError1, null, 'Valid row should pass validation');
  console.log('✓ Passed\n');

  // Test 4: Validation - missing email
  console.log('Test 4: Validation - missing email');
  const invalidRow = { ...csvRow, email: undefined };
  const validationError2 = validateMappedRow(invalidRow);
  assert.ok(validationError2?.includes('email'), 'Should fail validation for missing email');
  console.log('✓ Passed\n');

  // Test 5: Validation - invalid email format
  console.log('Test 5: Validation - invalid email format');
  const invalidEmailRow = { ...csvRow, email: 'not-an-email' };
  const validationError3 = validateMappedRow(invalidEmailRow);
  assert.ok(validationError3?.includes('email'), 'Should fail validation for invalid email');
  console.log('✓ Passed\n');

  // Test 6: Validation - invalid metadata JSON
  console.log('Test 6: Validation - invalid metadata JSON');
  const invalidMetadataRow = { ...csvRow, metadata: '{invalid json' };
  const validationError4 = validateMappedRow(invalidMetadataRow);
  assert.ok(validationError4?.includes('metadata'), 'Should fail validation for invalid metadata JSON');
  console.log('✓ Passed\n');

  // Test 7: Extract org from user metadata
  console.log('Test 7: Extract org from user metadata');
  const userWithOrgMetadata: Auth0User = {
    user_id: 'auth0|345678',
    email: 'user@example.com',
    email_verified: true,
    user_metadata: {
      organization_id: 'org_from_metadata',
      organization_name: 'Metadata Org'
    },
    created_at: '2024-01-15T10:30:00.000Z',
    updated_at: '2024-12-01T14:22:33.000Z'
  };

  const extractedOrg = extractOrgFromMetadata(userWithOrgMetadata);
  assert.ok(extractedOrg, 'Should extract org from metadata');
  assert.strictEqual(extractedOrg?.orgId, 'org_from_metadata', 'Should extract org ID');
  assert.strictEqual(extractedOrg?.orgName, 'Metadata Org', 'Should extract org name');
  console.log('✓ Passed\n');

  // Test 8: Extract org from app metadata
  console.log('Test 8: Extract org from app metadata');
  const userWithAppOrgMetadata: Auth0User = {
    user_id: 'auth0|456789',
    email: 'user2@example.com',
    email_verified: true,
    app_metadata: {
      org_id: 'org_from_app',
      org_name: 'App Org'
    },
    created_at: '2024-01-15T10:30:00.000Z',
    updated_at: '2024-12-01T14:22:33.000Z'
  };

  const extractedOrg2 = extractOrgFromMetadata(userWithAppOrgMetadata);
  assert.ok(extractedOrg2, 'Should extract org from app_metadata');
  assert.strictEqual(extractedOrg2?.orgId, 'org_from_app', 'Should extract org ID from app_metadata');
  assert.strictEqual(extractedOrg2?.orgName, 'App Org', 'Should extract org name from app_metadata');
  console.log('✓ Passed\n');

  // Test 9: No org in metadata
  console.log('Test 9: No org in metadata');
  const userWithoutOrgMetadata: Auth0User = {
    user_id: 'auth0|567890',
    email: 'user3@example.com',
    email_verified: true,
    user_metadata: { some_field: 'value' },
    created_at: '2024-01-15T10:30:00.000Z',
    updated_at: '2024-12-01T14:22:33.000Z'
  };

  const extractedOrg3 = extractOrgFromMetadata(userWithoutOrgMetadata);
  assert.strictEqual(extractedOrg3, null, 'Should return null when no org in metadata');
  console.log('✓ Passed\n');

  // Test 10: Org name fallback
  console.log('Test 10: Org name fallback to name when display_name missing');
  const orgWithoutDisplayName: Auth0Organization = {
    id: 'org_xyz789',
    name: 'Fallback Org'
  };

  const csvRow3 = mapAuth0UserToWorkOS(testUser, orgWithoutDisplayName);
  assert.strictEqual(csvRow3.org_name, 'Fallback Org', 'Should fallback to name when display_name missing');
  console.log('✓ Passed\n');

  // Test 11: Custom metadata field names
  console.log('Test 11: Custom metadata field names');
  const userWithCustomFields: Auth0User = {
    user_id: 'auth0|custom001',
    email: 'custom@example.com',
    email_verified: true,
    user_metadata: {
      company_id: 'company_123',
      company_name: 'Custom Company',
      department: 'Engineering'
    },
    created_at: '2024-01-15T10:30:00.000Z',
    updated_at: '2024-12-01T14:22:33.000Z'
  };

  // Should extract using custom field names
  const extractedOrg4 = extractOrgFromMetadata(userWithCustomFields, 'company_id', 'company_name');
  assert.ok(extractedOrg4, 'Should extract org using custom field names');
  assert.strictEqual(extractedOrg4?.orgId, 'company_123', 'Should extract custom org ID field');
  assert.strictEqual(extractedOrg4?.orgName, 'Custom Company', 'Should extract custom org name field');
  console.log('✓ Passed\n');

  // Test 12: Custom fields with fallback to defaults
  console.log('Test 12: Custom fields with fallback to defaults');
  const userWithMixedFields: Auth0User = {
    user_id: 'auth0|mixed001',
    email: 'mixed@example.com',
    email_verified: true,
    user_metadata: {
      organization_id: 'org_default',  // Default field
      company_name: 'Mixed Company'     // Custom field
    },
    created_at: '2024-01-15T10:30:00.000Z',
    updated_at: '2024-12-01T14:22:33.000Z'
  };

  // Custom field for name exists but not for ID, should fallback to default ID
  const extractedOrg5 = extractOrgFromMetadata(userWithMixedFields, 'company_id', 'company_name');
  assert.ok(extractedOrg5, 'Should extract org with mixed custom/default fields');
  assert.strictEqual(extractedOrg5?.orgId, 'org_default', 'Should fallback to default org ID field');
  assert.strictEqual(extractedOrg5?.orgName, 'Mixed Company', 'Should use custom org name field');
  console.log('✓ Passed\n');

  console.log('All Auth0 exporter tests passed! ✓');
}

main().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
