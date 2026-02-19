import { createReadStream, existsSync } from 'node:fs';
import { parse } from 'csv-parse';
import type { RoleDefinitionRow, ParsedRoleDefinition } from './types.js';

const REQUIRED_COLUMNS = ['role_slug', 'role_name', 'role_type', 'permissions'];
const VALID_ROLE_TYPES = new Set(['environment', 'organization']);

/** Parse permissions string: tries JSON array first, falls back to comma-split */
export function parsePermissions(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  // Try JSON array format first: ["perm1","perm2"]
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((p: unknown) => String(p).trim()).filter(Boolean);
      }
    } catch {
      // Fall through to comma-split
    }
  }

  // Comma-separated format: perm1,perm2,perm3
  return trimmed.split(',').map(p => p.trim()).filter(Boolean);
}

/** Parse role definitions CSV into structured objects */
export async function parseRoleDefinitionsCsv(
  csvPath: string
): Promise<{
  definitions: ParsedRoleDefinition[];
  warnings: string[];
  errors: string[];
}> {
  if (!existsSync(csvPath)) {
    throw new Error(`Role definitions CSV not found: ${csvPath}`);
  }

  const definitions: ParsedRoleDefinition[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];

  // Track seen slugs for deduplication (key: slug for env, slug:orgId for org)
  const seen = new Map<string, number>(); // key → row number

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
              `Role definitions CSV missing required columns: ${missingColumns.join(', ')}. ` +
              `Found columns: ${headers.join(', ')}`
            ));
            return;
          }
        }

        const typedRow: RoleDefinitionRow = {
          role_slug: row.role_slug?.trim() ?? '',
          role_name: row.role_name?.trim() ?? '',
          role_type: row.role_type?.trim() as RoleDefinitionRow['role_type'],
          permissions: row.permissions ?? '',
          org_id: row.org_id?.trim() || undefined,
          org_external_id: row.org_external_id?.trim() || undefined,
        };

        // Validate role_slug
        if (!typedRow.role_slug) {
          errors.push(`Row ${rowNumber}: Missing role_slug`);
          return;
        }

        // Validate role_name
        if (!typedRow.role_name) {
          errors.push(`Row ${rowNumber}: Missing role_name for slug "${typedRow.role_slug}"`);
          return;
        }

        // Validate role_type
        if (!VALID_ROLE_TYPES.has(typedRow.role_type)) {
          warnings.push(
            `Row ${rowNumber}: Invalid role_type "${typedRow.role_type}" for slug "${typedRow.role_slug}" — skipping`
          );
          return;
        }

        // Validate org-level roles have org reference
        if (typedRow.role_type === 'organization') {
          if (!typedRow.org_id && !typedRow.org_external_id) {
            warnings.push(
              `Row ${rowNumber}: Organization role "${typedRow.role_slug}" missing org_id or org_external_id — skipping`
            );
            return;
          }
        }

        // Parse permissions
        const permissions = parsePermissions(typedRow.permissions);

        // Build dedup key
        const dedupKey = typedRow.role_type === 'organization'
          ? `${typedRow.role_slug}:${typedRow.org_id || typedRow.org_external_id}`
          : typedRow.role_slug;

        // Check for duplicates
        const previousRow = seen.get(dedupKey);
        if (previousRow !== undefined) {
          warnings.push(
            `Row ${rowNumber}: Duplicate role_slug "${typedRow.role_slug}" (same scope as row ${previousRow}) — using first definition`
          );
          return;
        }
        seen.set(dedupKey, rowNumber);

        // Build parsed definition
        definitions.push({
          slug: typedRow.role_slug,
          name: typedRow.role_name,
          type: typedRow.role_type,
          permissions,
          orgId: typedRow.org_id,
          orgExternalId: typedRow.org_external_id,
        });
      })
      .on('end', () => {
        resolve({ definitions, warnings, errors });
      })
      .on('error', reject);
  });
}
