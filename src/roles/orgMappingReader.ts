import { createReadStream, existsSync } from 'node:fs';
import { parse } from 'csv-parse';

export interface OrgMappingEntry {
  orgExternalId: string;
  orgName?: string;
}

/**
 * Parse an org mapping CSV and extract unique organizations.
 *
 * Reads any CSV that has an `org_external_id` column (and optionally `org_name`),
 * deduplicates by org_external_id, and returns unique entries for cache pre-warming.
 *
 * Rows without an `org_external_id` value are skipped (e.g., rows that use `org_id` directly).
 */
export async function parseOrgMappingForUniqueOrgs(
  csvPath: string
): Promise<OrgMappingEntry[]> {
  if (!existsSync(csvPath)) {
    throw new Error(`Org mapping CSV not found: ${csvPath}`);
  }

  const uniqueOrgs = new Map<string, OrgMappingEntry>();

  return new Promise((resolve, reject) => {
    const inputStream = createReadStream(csvPath);
    const parser = parse({
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    inputStream
      .pipe(parser)
      .on('data', (row: Record<string, string>) => {
        const orgExternalId = row.org_external_id?.trim();
        if (!orgExternalId) return;

        // First occurrence wins for org_name
        if (uniqueOrgs.has(orgExternalId)) return;

        uniqueOrgs.set(orgExternalId, {
          orgExternalId,
          orgName: row.org_name?.trim() || undefined,
        });
      })
      .on('end', () => {
        resolve(Array.from(uniqueOrgs.values()));
      })
      .on('error', reject);
  });
}
