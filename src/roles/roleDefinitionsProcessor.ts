import type {
  ParsedRoleDefinition,
  RoleProcessingResult,
  RoleDefinitionsSummary,
} from './types.js';
import { RoleCache } from './roleCache.js';
import {
  createEnvironmentRole,
  createOrganizationRole,
  createPermission,
  assignPermissionsToEnvironmentRole,
  assignPermissionsToOrganizationRole,
} from './roleApiClient.js';
import { parseRoleDefinitionsCsv } from './roleDefinitionsCsvParser.js';
import { OrganizationCache } from '../cache/organizationCache.js';

export interface ProcessRoleDefinitionsOptions {
  csvPath: string;
  roleCache: RoleCache;
  orgCache?: OrganizationCache;  // For resolving org_external_id
  dryRun?: boolean;
  quiet?: boolean;
}

/** Compare two permission sets (order-independent) */
function comparePermissions(
  csvPerms: string[],
  existingPerms: string[]
): { match: boolean; missing: string[]; extra: string[] } {
  const csvSet = new Set(csvPerms);
  const existingSet = new Set(existingPerms);

  const missing = csvPerms.filter(p => !existingSet.has(p));
  const extra = existingPerms.filter(p => !csvSet.has(p));

  return {
    match: missing.length === 0 && extra.length === 0,
    missing,
    extra,
  };
}

/** Ensure all unique permissions from role definitions exist in WorkOS */
async function ensurePermissionsExist(
  definitions: ParsedRoleDefinition[],
  dryRun: boolean,
  quiet: boolean
): Promise<{ created: number; existed: number; failed: number }> {
  // Collect unique permission slugs
  const uniquePerms = new Set<string>();
  for (const def of definitions) {
    for (const perm of def.permissions) {
      uniquePerms.add(perm);
    }
  }

  if (uniquePerms.size === 0) {
    return { created: 0, existed: 0, failed: 0 };
  }

  if (!quiet) {
    console.log(`Ensuring ${uniquePerms.size} unique permissions exist...`);
  }

  let created = 0;
  let existed = 0;
  let failed = 0;

  for (const slug of Array.from(uniquePerms)) {
    if (dryRun) {
      if (!quiet) {
        console.log(`  [DRY RUN] Would ensure permission "${slug}" exists`);
      }
      created++;
      continue;
    }

    try {
      // Use the slug as the display name (capitalize and replace separators)
      const name = slug
        .split(/[:._-]/)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');

      const wasCreated = await createPermission({ slug, name });
      if (wasCreated) {
        created++;
        if (!quiet) {
          console.log(`  + Created permission "${slug}"`);
        }
      } else {
        existed++;
        if (!quiet) {
          console.log(`  ✓ Permission "${slug}" already exists`);
        }
      }
    } catch (err: any) {
      failed++;
      if (!quiet) {
        console.error(`  ✗ Failed to create permission "${slug}": ${err?.message}`);
      }
    }
  }

  if (!quiet) {
    console.log(`  Permissions: ${created} created, ${existed} already exist, ${failed} failed`);
    console.log('');
  }

  return { created, existed, failed };
}

/** Process a single environment role definition */
async function processEnvironmentRole(
  definition: ParsedRoleDefinition,
  roleCache: RoleCache,
  dryRun: boolean,
  quiet: boolean
): Promise<RoleProcessingResult> {
  const result: RoleProcessingResult = {
    slug: definition.slug,
    action: 'error',
    warnings: [],
  };

  try {
    // Check if role already exists in cache
    const existing = await roleCache.resolve(definition.slug);

    if (existing) {
      // Role exists — compare permissions
      const comparison = comparePermissions(definition.permissions, existing.permissions);

      if (!comparison.match) {
        result.warnings.push(
          `Permission mismatch for environment role "${definition.slug}": ` +
          `missing=[${comparison.missing.join(',')}] extra=[${comparison.extra.join(',')}]`
        );
        result.permissionDiff = {
          csvPermissions: definition.permissions,
          existingPermissions: existing.permissions,
          missing: comparison.missing,
          extra: comparison.extra,
        };
      }

      result.action = 'exists';
      if (!quiet) {
        console.log(`  ✓ Environment role "${definition.slug}" already exists`);
      }
      return result;
    }

    // Role doesn't exist — create it
    if (dryRun) {
      result.action = 'created';
      if (!quiet) {
        console.log(`  [DRY RUN] Would create environment role "${definition.slug}"`);
      }
      return result;
    }

    const created = await createEnvironmentRole({
      name: definition.name,
      slug: definition.slug,
    });

    // Assign permissions if any
    if (definition.permissions.length > 0) {
      await assignPermissionsToEnvironmentRole({
        roleSlug: created.slug,
        permissions: definition.permissions,
      });
      created.permissions = definition.permissions;
    }

    // Cache the new role
    roleCache.set({
      slug: created.slug,
      id: created.id,
      name: created.name,
      permissions: created.permissions,
      type: 'EnvironmentRole',
      cachedAt: Date.now(),
    });

    result.action = 'created';
    if (!quiet) {
      const permCount = definition.permissions.length;
      const permSuffix = permCount > 0 ? ` with ${permCount} permission(s)` : '';
      console.log(`  + Created environment role "${definition.slug}"${permSuffix}`);
    }
  } catch (err: any) {
    result.action = 'error';
    result.error = err?.message || String(err);
    if (!quiet) {
      console.error(`  ✗ Error creating environment role "${definition.slug}": ${result.error}`);
    }
  }

  return result;
}

/** Process a single organization role definition */
async function processOrganizationRole(
  definition: ParsedRoleDefinition,
  roleCache: RoleCache,
  orgCache: OrganizationCache | undefined,
  dryRun: boolean,
  quiet: boolean
): Promise<RoleProcessingResult> {
  const result: RoleProcessingResult = {
    slug: definition.slug,
    action: 'error',
    warnings: [],
  };

  try {
    // Resolve org ID
    let resolvedOrgId = definition.orgId;

    if (!resolvedOrgId && definition.orgExternalId) {
      if (!orgCache) {
        result.action = 'skipped';
        result.error = `No org cache available to resolve org_external_id "${definition.orgExternalId}"`;
        if (!quiet) {
          console.error(`  ✗ Skipping org role "${definition.slug}": ${result.error}`);
        }
        return result;
      }

      resolvedOrgId = await orgCache.resolve({
        orgExternalId: definition.orgExternalId,
      }) ?? undefined;

      if (!resolvedOrgId) {
        result.action = 'skipped';
        result.error = `Organization not found for org_external_id "${definition.orgExternalId}"`;
        if (!quiet) {
          console.error(`  ✗ Skipping org role "${definition.slug}": ${result.error}`);
        }
        return result;
      }
    }

    if (!resolvedOrgId) {
      result.action = 'skipped';
      result.error = 'No org_id or org_external_id provided';
      return result;
    }

    // Warm cache for this org (fetches all roles in one call)
    await roleCache.warmFromOrganization(resolvedOrgId);

    // Check if role exists
    const existing = await roleCache.resolve(definition.slug, resolvedOrgId);

    if (existing) {
      // Role exists — compare permissions
      const comparison = comparePermissions(definition.permissions, existing.permissions);

      if (!comparison.match) {
        result.warnings.push(
          `Permission mismatch for org role "${definition.slug}" in org ${resolvedOrgId}: ` +
          `missing=[${comparison.missing.join(',')}] extra=[${comparison.extra.join(',')}]`
        );
        result.permissionDiff = {
          csvPermissions: definition.permissions,
          existingPermissions: existing.permissions,
          missing: comparison.missing,
          extra: comparison.extra,
        };
      }

      result.action = 'exists';
      if (!quiet) {
        console.log(`  ✓ Org role "${definition.slug}" already exists in org ${resolvedOrgId}`);
      }
      return result;
    }

    // Role doesn't exist — create it
    if (dryRun) {
      result.action = 'created';
      if (!quiet) {
        console.log(`  [DRY RUN] Would create org role "${definition.slug}" in org ${resolvedOrgId}`);
      }
      return result;
    }

    const created = await createOrganizationRole({
      organizationId: resolvedOrgId,
      name: definition.name,
      slug: definition.slug,
    });

    // Assign permissions if any
    if (definition.permissions.length > 0) {
      await assignPermissionsToOrganizationRole({
        organizationId: resolvedOrgId,
        roleSlug: created.slug,
        permissions: definition.permissions,
      });
      created.permissions = definition.permissions;
    }

    // Cache the new role
    roleCache.set({
      slug: created.slug,
      id: created.id,
      name: created.name,
      permissions: created.permissions,
      type: 'OrganizationRole',
      orgId: resolvedOrgId,
      cachedAt: Date.now(),
    });

    result.action = 'created';
    if (!quiet) {
      const permCount = definition.permissions.length;
      const permSuffix = permCount > 0 ? ` with ${permCount} permission(s)` : '';
      console.log(`  + Created org role "${definition.slug}" in org ${resolvedOrgId}${permSuffix}`);
    }
  } catch (err: any) {
    result.action = 'error';
    result.error = err?.message || String(err);
    if (!quiet) {
      console.error(`  ✗ Error creating org role "${definition.slug}": ${result.error}`);
    }
  }

  return result;
}

/** Process all role definitions from CSV */
export async function processRoleDefinitions(
  options: ProcessRoleDefinitionsOptions
): Promise<RoleDefinitionsSummary> {
  const { csvPath, roleCache, orgCache, dryRun = false, quiet = false } = options;

  // Parse CSV
  if (!quiet) {
    console.log('Parsing role definitions CSV...');
  }

  const { definitions, warnings: parseWarnings, errors: parseErrors } =
    await parseRoleDefinitionsCsv(csvPath);

  if (parseErrors.length > 0 && !quiet) {
    console.log(`\nCSV parse errors:`);
    for (const err of parseErrors) {
      console.error(`  - ${err}`);
    }
  }

  if (parseWarnings.length > 0 && !quiet) {
    console.log(`\nCSV parse warnings:`);
    for (const warn of parseWarnings) {
      console.warn(`  - ${warn}`);
    }
  }

  // Separate environment and org roles
  const envRoles = definitions.filter(d => d.type === 'environment');
  const orgRoles = definitions.filter(d => d.type === 'organization');

  if (!quiet) {
    console.log(`\nFound ${definitions.length} role definitions:`);
    console.log(`  Environment roles: ${envRoles.length}`);
    console.log(`  Organization roles: ${orgRoles.length}`);
    if (dryRun) {
      console.log('  Mode: DRY RUN (no API calls)');
    }
    console.log('');
  }

  // Step 1: Ensure all permissions exist before creating roles
  await ensurePermissionsExist(definitions, dryRun, quiet);

  const results: RoleProcessingResult[] = [];
  const allWarnings: string[] = [...parseWarnings];

  // Step 2: Process environment roles
  if (envRoles.length > 0 && !quiet) {
    console.log('Processing environment roles...');
  }

  for (const def of envRoles) {
    const result = await processEnvironmentRole(def, roleCache, dryRun, quiet);
    results.push(result);
    allWarnings.push(...result.warnings);
  }

  // Step 3: Process organization roles
  if (orgRoles.length > 0 && !quiet) {
    console.log('\nProcessing organization roles...');
  }

  for (const def of orgRoles) {
    const result = await processOrganizationRole(def, roleCache, orgCache, dryRun, quiet);
    results.push(result);
    allWarnings.push(...result.warnings);
  }

  // Build summary
  const summary: RoleDefinitionsSummary = {
    total: definitions.length,
    created: results.filter(r => r.action === 'created').length,
    alreadyExist: results.filter(r => r.action === 'exists').length,
    skipped: results.filter(r => r.action === 'skipped').length,
    errors: results.filter(r => r.action === 'error').length + parseErrors.length,
    warnings: allWarnings,
    results,
  };

  return summary;
}
