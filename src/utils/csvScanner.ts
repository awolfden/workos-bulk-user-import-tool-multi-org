/**
 * CSV Scanner Utility
 *
 * Fast single-pass CSV scanning to extract unique organization identifiers
 * without making any API calls. Used for pre-warming the organization cache
 * before starting worker pool.
 */

import fs from "node:fs";
import { parse } from "csv-parse";

export interface UniqueOrgInfo {
  orgExternalId: string;
  orgName: string | null;
}

/**
 * Extract unique organization identifiers from CSV file
 *
 * Performs a fast single-pass scan of the CSV to identify all unique
 * org_external_id values along with their corresponding org_name.
 * This data is used to pre-warm the organization cache before processing.
 *
 * @param csvPath - Path to CSV file to scan
 * @returns Array of unique organization identifiers with names
 *
 * @example
 * const orgs = await extractUniqueOrganizations('./users.csv');
 * // [{ orgExternalId: 'org_123', orgName: 'Acme Corp' }, ...]
 */
export async function extractUniqueOrganizations(csvPath: string): Promise<UniqueOrgInfo[]> {
  const orgMap = new Map<string, string | null>();

  const input = fs.createReadStream(csvPath);
  const parser = parse({
    columns: true,
    bom: true,
    skip_empty_lines: true,
    trim: true
  });

  await new Promise<void>((resolve, reject) => {
    parser.on("readable", () => {
      let row: any;
      while ((row = parser.read()) !== null) {
        // Extract org fields
        const orgExternalId = typeof row.org_external_id === "string" && row.org_external_id.trim() !== ""
          ? row.org_external_id.trim()
          : null;

        const orgName = typeof row.org_name === "string" && row.org_name.trim() !== ""
          ? row.org_name.trim()
          : null;

        // Skip rows without org_external_id
        if (!orgExternalId) {
          continue;
        }

        // Store first occurrence of each org_external_id
        // If CSV has multiple rows with same external_id but different names,
        // we take the first name encountered (they should be consistent anyway)
        if (!orgMap.has(orgExternalId)) {
          orgMap.set(orgExternalId, orgName);
        }
      }
    });

    parser.on("end", () => resolve());
    parser.on("error", (err) => reject(err));

    input.pipe(parser);
  });

  // Convert Map to sorted array for deterministic ordering
  const uniqueOrgs: UniqueOrgInfo[] = [];

  for (const [orgExternalId, orgName] of orgMap.entries()) {
    uniqueOrgs.push({
      orgExternalId,
      orgName
    });
  }

  // Sort by external_id for deterministic processing order
  uniqueOrgs.sort((a, b) => a.orgExternalId.localeCompare(b.orgExternalId));

  return uniqueOrgs;
}

/**
 * Get count of unique organizations in CSV without full extraction
 * Useful for quick validation before pre-warming
 *
 * @param csvPath - Path to CSV file to scan
 * @returns Count of unique org_external_id values
 */
export async function countUniqueOrganizations(csvPath: string): Promise<number> {
  const orgs = await extractUniqueOrganizations(csvPath);
  return orgs.length;
}
