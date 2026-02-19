/**
 * Clerk CSV Transformer
 *
 * Reads a Clerk user CSV export and an optional org mapping CSV,
 * transforms them into a WorkOS-compatible CSV for the validate → import pipeline.
 *
 * Architecture:
 * - Org mapping CSV is loaded eagerly into a Map (small, fits in memory)
 * - Clerk user CSV is streamed row-by-row for memory efficiency
 * - Output CSV is written via csv-stringify streaming
 */

import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { parse } from 'csv-parse';
import { stringify } from 'csv-stringify';
import type { ClerkUserRow, OrgMappingRow } from './clerkMapper.js';
import { mapClerkUserToWorkOS } from './clerkMapper.js';

export interface TransformOptions {
  clerkCsvPath: string;
  outputPath: string;
  orgMappingPath?: string;
  roleMappingPath?: string;
  skippedUsersPath?: string;
  quiet?: boolean;
}

export interface TransformSummary {
  totalUsers: number;
  transformedUsers: number;
  skippedUsers: number;
  usersWithPasswords: number;
  usersWithoutPasswords: number;
  usersWithOrgMapping: number;
  usersWithoutOrgMapping: number;
  usersWithRoleMapping: number;
  skippedReasons: Record<string, number>;
}

/**
 * Load org mapping CSV into a lookup Map keyed by clerk_user_id
 */
export async function loadOrgMapping(
  filePath: string,
  quiet?: boolean
): Promise<Map<string, OrgMappingRow>> {
  const lookup = new Map<string, OrgMappingRow>();

  if (!existsSync(filePath)) {
    throw new Error(`Org mapping file not found: ${filePath}`);
  }

  return new Promise((resolve, reject) => {
    let headerValidated = false;
    let duplicateCount = 0;

    const inputStream = createReadStream(filePath);
    const parser = parse({
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    inputStream
      .pipe(parser)
      .on('data', (row: Record<string, string>) => {
        // Validate headers on first row
        if (!headerValidated) {
          headerValidated = true;
          const headers = Object.keys(row);

          if (!headers.includes('clerk_user_id')) {
            reject(new Error(
              `Org mapping CSV must have a 'clerk_user_id' column. ` +
              `Found columns: ${headers.join(', ')}`
            ));
            return;
          }

          const hasOrgColumn =
            headers.includes('org_id') ||
            headers.includes('org_external_id') ||
            headers.includes('org_name');

          if (!hasOrgColumn) {
            reject(new Error(
              `Org mapping CSV must have at least one of: org_id, org_external_id, org_name. ` +
              `Found columns: ${headers.join(', ')}`
            ));
            return;
          }

          if (!quiet) {
            const mode = detectOrgMappingMode(headers);
            console.log(`  Org mapping mode: ${mode}`);
          }
        }

        const clerkUserId = row.clerk_user_id?.trim();
        if (!clerkUserId) return;

        if (lookup.has(clerkUserId)) {
          duplicateCount++;
        }

        lookup.set(clerkUserId, {
          clerk_user_id: clerkUserId,
          org_id: row.org_id?.trim() || undefined,
          org_external_id: row.org_external_id?.trim() || undefined,
          org_name: row.org_name?.trim() || undefined,
        });
      })
      .on('end', () => {
        if (duplicateCount > 0 && !quiet) {
          console.warn(
            `  Warning: ${duplicateCount} duplicate clerk_user_id(s) found in org mapping — using last occurrence`
          );
        }
        resolve(lookup);
      })
      .on('error', reject);
  });
}

/**
 * Load role mapping CSV into a lookup Map keyed by clerk_user_id
 *
 * Unlike the userRoleMappingParser (which uses external_id), the Clerk role
 * mapping uses clerk_user_id as the join key because at transform time the
 * external_id hasn't been set yet.
 */
export async function loadRoleMapping(
  filePath: string,
  quiet?: boolean
): Promise<Map<string, string[]>> {
  const lookup = new Map<string, string[]>();

  if (!existsSync(filePath)) {
    throw new Error(`Role mapping file not found: ${filePath}`);
  }

  return new Promise((resolve, reject) => {
    let headerValidated = false;

    const inputStream = createReadStream(filePath);
    const parser = parse({
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    inputStream
      .pipe(parser)
      .on('data', (row: Record<string, string>) => {
        if (!headerValidated) {
          headerValidated = true;
          const headers = Object.keys(row);

          // Accept either clerk_user_id or external_id as the join key
          const hasJoinKey = headers.includes('clerk_user_id') || headers.includes('external_id');
          if (!hasJoinKey) {
            reject(new Error(
              `Role mapping CSV must have a 'clerk_user_id' or 'external_id' column. ` +
              `Found columns: ${headers.join(', ')}`
            ));
            return;
          }

          if (!headers.includes('role_slug')) {
            reject(new Error(
              `Role mapping CSV must have a 'role_slug' column. ` +
              `Found columns: ${headers.join(', ')}`
            ));
            return;
          }
        }

        const userId = (row.clerk_user_id?.trim() || row.external_id?.trim()) ?? '';
        const roleSlug = row.role_slug?.trim() ?? '';
        if (!userId || !roleSlug) return;

        const existing = lookup.get(userId);
        if (existing) {
          if (!existing.includes(roleSlug)) {
            existing.push(roleSlug);
          }
        } else {
          lookup.set(userId, [roleSlug]);
        }
      })
      .on('end', () => {
        if (!quiet) {
          console.log(`  Loaded ${lookup.size} user role mappings`);
        }
        resolve(lookup);
      })
      .on('error', reject);
  });
}

/**
 * Detect org mapping mode from CSV headers
 */
function detectOrgMappingMode(headers: string[]): string {
  const hasOrgId = headers.includes('org_id');
  const hasOrgExternalId = headers.includes('org_external_id');
  const hasOrgName = headers.includes('org_name');

  if (hasOrgId) return 'org_id (direct WorkOS org lookup)';
  if (hasOrgExternalId && hasOrgName) return 'org_external_id + org_name (create if missing)';
  if (hasOrgExternalId) return 'org_external_id (lookup by external ID)';
  if (hasOrgName) return 'org_name (lookup or create by name)';
  return 'unknown';
}

/**
 * Transform a Clerk CSV export to WorkOS CSV format
 */
export async function transformClerkExport(
  options: TransformOptions
): Promise<TransformSummary> {
  const { clerkCsvPath, outputPath, orgMappingPath, roleMappingPath, skippedUsersPath, quiet } = options;

  // Validate Clerk CSV exists
  if (!existsSync(clerkCsvPath)) {
    throw new Error(`Clerk CSV file not found: ${clerkCsvPath}`);
  }

  // Load org mapping if provided
  let orgMapping: Map<string, OrgMappingRow> | null = null;
  if (orgMappingPath) {
    if (!quiet) {
      console.log('Loading org mapping...');
    }
    orgMapping = await loadOrgMapping(orgMappingPath, quiet);
    if (!quiet) {
      console.log(`  Loaded ${orgMapping.size} org mapping entries\n`);
    }
  }

  // Load role mapping if provided
  let roleMapping: Map<string, string[]> | null = null;
  if (roleMappingPath) {
    if (!quiet) {
      console.log('Loading role mapping...');
    }
    roleMapping = await loadRoleMapping(roleMappingPath, quiet);
    if (!quiet) {
      console.log('');
    }
  }

  // Determine output columns based on what data is available
  const outputColumns = buildOutputColumns(orgMapping, roleMapping);

  // Track stats
  const summary: TransformSummary = {
    totalUsers: 0,
    transformedUsers: 0,
    skippedUsers: 0,
    usersWithPasswords: 0,
    usersWithoutPasswords: 0,
    usersWithOrgMapping: 0,
    usersWithoutOrgMapping: 0,
    usersWithRoleMapping: 0,
    skippedReasons: {},
  };

  // Set up skipped users output
  let skippedStream: import('node:fs').WriteStream | null = null;
  if (skippedUsersPath) {
    skippedStream = createWriteStream(skippedUsersPath, { flags: 'w', encoding: 'utf8' });
  }

  return new Promise((resolve, reject) => {
    let headerValidated = false;

    const inputStream = createReadStream(clerkCsvPath);
    const outputStream = createWriteStream(outputPath);

    const parser = parse({
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
    });

    const stringifier = stringify({
      header: true,
      columns: outputColumns,
    });

    inputStream
      .pipe(parser)
      .on('data', (row: ClerkUserRow) => {
        // Validate headers on first row
        if (!headerValidated) {
          headerValidated = true;
          const headers = Object.keys(row);

          if (!headers.includes('primary_email_address')) {
            reject(new Error(
              `Clerk CSV must have a 'primary_email_address' column. ` +
              `Found columns: ${headers.join(', ')}`
            ));
            return;
          }

          if (!headers.includes('id')) {
            reject(new Error(
              `Clerk CSV must have an 'id' column. ` +
              `Found columns: ${headers.join(', ')}`
            ));
            return;
          }
        }

        summary.totalUsers++;

        // Look up org mapping for this user
        const clerkUserId = row.id?.trim();
        const userOrgMapping = clerkUserId && orgMapping
          ? orgMapping.get(clerkUserId) ?? undefined
          : undefined;

        // Map to WorkOS format
        const result = mapClerkUserToWorkOS(row, userOrgMapping);

        // Handle skipped users
        if (result.skipped) {
          summary.skippedUsers++;
          const reason = result.skipReason || 'unknown';
          summary.skippedReasons[reason] = (summary.skippedReasons[reason] || 0) + 1;

          if (skippedStream) {
            skippedStream.write(JSON.stringify({
              clerk_user_id: clerkUserId,
              email: row.primary_email_address,
              reason,
              originalRow: row,
            }) + '\n');
          }
          return;
        }

        // Track warnings (non-bcrypt passwords still transform the user, just skip password)
        for (const warning of result.warnings) {
          if (warning.includes('Unsupported password hasher')) {
            // Still count in skipped reasons for reporting
            const reason = 'non-bcrypt password (user still imported, password skipped)';
            summary.skippedReasons[reason] = (summary.skippedReasons[reason] || 0) + 1;
          }
        }

        // Track stats
        summary.transformedUsers++;
        if (result.row.password_hash) {
          summary.usersWithPasswords++;
        } else {
          summary.usersWithoutPasswords++;
        }
        if (userOrgMapping) {
          summary.usersWithOrgMapping++;
        } else {
          summary.usersWithoutOrgMapping++;
        }

        // Merge role slugs if role mapping provided
        if (roleMapping && clerkUserId) {
          const roleSlugs = roleMapping.get(clerkUserId);
          if (roleSlugs?.length) {
            result.row.role_slugs = roleSlugs.join(',');
            summary.usersWithRoleMapping++;
          }
        }

        // Write to output
        stringifier.write(result.row);

        // Progress reporting
        if (!quiet && summary.totalUsers % 1000 === 0) {
          process.stdout.write(
            `  Processed ${summary.totalUsers} users (${summary.transformedUsers} transformed)...\r`
          );
        }
      })
      .on('end', () => {
        stringifier.end();
        if (!quiet && summary.totalUsers >= 1000) {
          process.stdout.write('\n');
        }
        if (skippedStream) {
          skippedStream.end();
        }
      })
      .on('error', (error) => {
        if (skippedStream) skippedStream.end();
        reject(error);
      });

    stringifier
      .pipe(outputStream)
      .on('finish', () => {
        if (summary.totalUsers === 0) {
          reject(new Error('No users found in Clerk CSV'));
          return;
        }
        resolve(summary);
      })
      .on('error', (error) => {
        reject(error);
      });
  });
}

/**
 * Determine output CSV columns based on available data
 */
function buildOutputColumns(
  orgMapping: Map<string, OrgMappingRow> | null,
  roleMapping?: Map<string, string[]> | null
): string[] {
  const columns = [
    'email',
    'first_name',
    'last_name',
    'email_verified',
    'external_id',
    'password_hash',
    'password_hash_type',
    'metadata',
  ];

  // Add org columns if org mapping is provided
  if (orgMapping && orgMapping.size > 0) {
    // Check which org columns are in use
    const firstEntry = orgMapping.values().next().value;
    if (firstEntry) {
      if (firstEntry.org_id !== undefined) columns.push('org_id');
      if (firstEntry.org_external_id !== undefined) columns.push('org_external_id');
      if (firstEntry.org_name !== undefined) columns.push('org_name');
    }
  }

  // Add role_slugs column if role mapping is provided
  if (roleMapping && roleMapping.size > 0) {
    columns.push('role_slugs');
  }

  return columns;
}
