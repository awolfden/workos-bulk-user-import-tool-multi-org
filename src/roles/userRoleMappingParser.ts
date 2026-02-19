import { createReadStream, existsSync } from 'node:fs';
import { parse } from 'csv-parse';

export interface UserRoleMappingOptions {
  csvPath: string;
  quiet?: boolean;
}

export interface UserRoleMappingResult {
  /** Map from external_id to array of role slugs */
  mapping: Map<string, string[]>;
  /** Total rows parsed */
  totalRows: number;
  /** Unique users with role assignments */
  uniqueUsers: number;
  /** Unique role slugs referenced */
  uniqueRoles: Set<string>;
  /** Parse warnings */
  warnings: string[];
}

const REQUIRED_COLUMNS = ['external_id', 'role_slug'];

/** Parse user-role mapping CSV into an in-memory lookup map */
export async function parseUserRoleMapping(
  options: UserRoleMappingOptions
): Promise<UserRoleMappingResult> {
  const { csvPath, quiet } = options;

  if (!existsSync(csvPath)) {
    throw new Error(`User-role mapping CSV not found: ${csvPath}`);
  }

  const mapping = new Map<string, string[]>();
  const uniqueRoles = new Set<string>();
  const warnings: string[] = [];
  let totalRows = 0;

  return new Promise((resolve, reject) => {
    let headerValidated = false;
    let rowNumber = 0;

    const inputStream = createReadStream(csvPath);
    const parser = parse({
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    inputStream
      .pipe(parser)
      .on('data', (row: Record<string, string>) => {
        rowNumber++;

        // Validate headers on first row
        if (!headerValidated) {
          headerValidated = true;
          const headers = Object.keys(row);
          const missingColumns = REQUIRED_COLUMNS.filter(
            col => !headers.includes(col)
          );

          if (missingColumns.length > 0) {
            reject(new Error(
              `User-role mapping CSV missing required columns: ${missingColumns.join(', ')}. ` +
              `Found columns: ${headers.join(', ')}`
            ));
            return;
          }
        }

        const externalId = row.external_id?.trim() ?? '';
        const roleSlug = row.role_slug?.trim() ?? '';

        // Validate non-empty fields
        if (!externalId) {
          warnings.push(`Row ${rowNumber}: Missing external_id — skipping`);
          return;
        }

        if (!roleSlug) {
          warnings.push(`Row ${rowNumber}: Missing role_slug for external_id "${externalId}" — skipping`);
          return;
        }

        totalRows++;
        uniqueRoles.add(roleSlug);

        // Add to mapping, deduplicating within each user's role list
        const existing = mapping.get(externalId);
        if (existing) {
          if (existing.includes(roleSlug)) {
            warnings.push(
              `Row ${rowNumber}: Duplicate role_slug "${roleSlug}" for external_id "${externalId}" — ignoring duplicate`
            );
          } else {
            existing.push(roleSlug);
          }
        } else {
          mapping.set(externalId, [roleSlug]);
        }
      })
      .on('end', () => {
        resolve({
          mapping,
          totalRows,
          uniqueUsers: mapping.size,
          uniqueRoles,
          warnings,
        });
      })
      .on('error', reject);
  });
}
