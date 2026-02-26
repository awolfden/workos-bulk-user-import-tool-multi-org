/**
 * Firebase JSON Transformer
 *
 * Reads a Firebase Auth JSON export and optional org/role mapping CSVs,
 * transforms them into a WorkOS-compatible CSV for the validate -> import pipeline.
 *
 * Architecture:
 * - Firebase JSON is read and parsed (users array)
 * - Org mapping CSV is loaded eagerly into a Map (small, fits in memory)
 * - Role mapping CSV is loaded eagerly into a Map
 * - Output CSV is written via csv-stringify streaming
 */

import { readFileSync, createReadStream, createWriteStream, existsSync } from 'node:fs';
import { parse } from 'csv-parse';
import { stringify } from 'csv-stringify';
import type { FirebaseUserRecord, FirebaseOrgMappingRow, NameSplitStrategy } from './firebaseMapper.js';
import { mapFirebaseUserToWorkOS } from './firebaseMapper.js';
import type { FirebaseScryptParams } from './phcEncoder.js';

export interface FirebaseTransformOptions {
  firebaseJsonPath: string;
  outputPath: string;
  scryptParams?: FirebaseScryptParams;
  nameSplitStrategy: NameSplitStrategy;
  includeDisabled?: boolean;
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
  disabledUsersSkipped: number;
  skippedReasons: Record<string, number>;
}

/**
 * Load org mapping CSV into a lookup Map keyed by firebase_uid
 */
export async function loadOrgMapping(
  filePath: string,
  quiet?: boolean
): Promise<Map<string, FirebaseOrgMappingRow>> {
  const lookup = new Map<string, FirebaseOrgMappingRow>();

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
        if (!headerValidated) {
          headerValidated = true;
          const headers = Object.keys(row);

          if (!headers.includes('firebase_uid')) {
            reject(new Error(
              `Org mapping CSV must have a 'firebase_uid' column. ` +
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

        const uid = row.firebase_uid?.trim();
        if (!uid) return;

        if (lookup.has(uid)) {
          duplicateCount++;
        }

        lookup.set(uid, {
          firebase_uid: uid,
          org_id: row.org_id?.trim() || undefined,
          org_external_id: row.org_external_id?.trim() || undefined,
          org_name: row.org_name?.trim() || undefined,
        });
      })
      .on('end', () => {
        if (duplicateCount > 0 && !quiet) {
          console.warn(
            `  Warning: ${duplicateCount} duplicate firebase_uid(s) found in org mapping — using last occurrence`
          );
        }
        resolve(lookup);
      })
      .on('error', reject);
  });
}

/**
 * Load role mapping CSV into a lookup Map keyed by firebase_uid
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

          const hasJoinKey = headers.includes('firebase_uid') || headers.includes('external_id');
          if (!hasJoinKey) {
            reject(new Error(
              `Role mapping CSV must have a 'firebase_uid' or 'external_id' column. ` +
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

        const userId = (row.firebase_uid?.trim() || row.external_id?.trim()) ?? '';
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
 * Parse Firebase JSON export and return users array
 */
function parseFirebaseExport(filePath: string): FirebaseUserRecord[] {
  const raw = readFileSync(filePath, 'utf8');
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in Firebase export file: ${filePath}`);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Firebase export must be a JSON object with a "users" array`);
  }

  const data = parsed as Record<string, unknown>;

  if (!Array.isArray(data.users)) {
    throw new Error(
      `Firebase export must have a "users" array at the top level. ` +
      `Found keys: ${Object.keys(data).join(', ')}`
    );
  }

  return data.users as FirebaseUserRecord[];
}

/**
 * Transform a Firebase JSON export to WorkOS CSV format
 */
export async function transformFirebaseExport(
  options: FirebaseTransformOptions
): Promise<TransformSummary> {
  const {
    firebaseJsonPath,
    outputPath,
    scryptParams,
    nameSplitStrategy,
    includeDisabled,
    orgMappingPath,
    roleMappingPath,
    skippedUsersPath,
    quiet,
  } = options;

  // Validate Firebase JSON exists
  if (!existsSync(firebaseJsonPath)) {
    throw new Error(`Firebase JSON file not found: ${firebaseJsonPath}`);
  }

  // Parse Firebase export
  if (!quiet) {
    console.log('Parsing Firebase JSON export...');
  }
  const users = parseFirebaseExport(firebaseJsonPath);
  if (!quiet) {
    console.log(`  Found ${users.length} users\n`);
  }

  // Load org mapping if provided
  let orgMapping: Map<string, FirebaseOrgMappingRow> | null = null;
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

  // Determine output columns
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
    disabledUsersSkipped: 0,
    skippedReasons: {},
  };

  // Set up skipped users output
  let skippedStream: import('node:fs').WriteStream | null = null;
  if (skippedUsersPath) {
    skippedStream = createWriteStream(skippedUsersPath, { flags: 'w', encoding: 'utf8' });
  }

  // Set up CSV output
  return new Promise((resolve, reject) => {
    const outputStream = createWriteStream(outputPath);
    const stringifier = stringify({
      header: true,
      columns: outputColumns,
    });

    stringifier
      .pipe(outputStream)
      .on('finish', () => {
        if (summary.totalUsers === 0) {
          // Empty users array is valid, just no output
        }
        resolve(summary);
      })
      .on('error', reject);

    const mapperOptions = {
      nameSplitStrategy,
      scryptParams,
      includeDisabled,
    };

    for (const user of users) {
      summary.totalUsers++;

      const uid = user.localId?.trim();
      const userOrgMapping = uid && orgMapping
        ? orgMapping.get(uid) ?? undefined
        : undefined;

      const result = mapFirebaseUserToWorkOS(user, mapperOptions, userOrgMapping);

      if (result.skipped) {
        summary.skippedUsers++;
        const reason = result.skipReason || 'unknown';
        summary.skippedReasons[reason] = (summary.skippedReasons[reason] || 0) + 1;

        if (reason === 'User is disabled') {
          summary.disabledUsersSkipped++;
        }

        if (skippedStream) {
          skippedStream.write(JSON.stringify({
            firebase_uid: uid,
            email: user.email,
            reason,
            originalRecord: user,
          }) + '\n');
        }
        continue;
      }

      // Track warnings
      for (const warning of result.warnings) {
        if (warning.includes('No scrypt parameters')) {
          const reason = 'no scrypt params (user still imported, password skipped)';
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

      // Merge role slugs
      if (roleMapping && uid) {
        const roleSlugs = roleMapping.get(uid);
        if (roleSlugs?.length) {
          result.row.role_slugs = roleSlugs.join(',');
          summary.usersWithRoleMapping++;
        }
      }

      stringifier.write(result.row);

      // Progress reporting
      if (!quiet && summary.totalUsers % 1000 === 0) {
        process.stdout.write(
          `  Processed ${summary.totalUsers} users (${summary.transformedUsers} transformed)...\r`
        );
      }
    }

    // Done processing
    stringifier.end();
    if (!quiet && summary.totalUsers >= 1000) {
      process.stdout.write('\n');
    }
    if (skippedStream) {
      skippedStream.end();
    }
  });
}

/**
 * Determine output CSV columns based on available data
 */
function buildOutputColumns(
  orgMapping: Map<string, FirebaseOrgMappingRow> | null,
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

  if (orgMapping && orgMapping.size > 0) {
    const firstEntry = orgMapping.values().next().value;
    if (firstEntry) {
      if (firstEntry.org_id !== undefined) columns.push('org_id');
      if (firstEntry.org_external_id !== undefined) columns.push('org_external_id');
      if (firstEntry.org_name !== undefined) columns.push('org_name');
    }
  }

  if (roleMapping && roleMapping.size > 0) {
    columns.push('role_slugs');
  }

  return columns;
}
