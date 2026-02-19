#!/usr/bin/env node
/**
 * Process Role Definitions
 *
 * Creates roles and permissions in WorkOS from a definitions CSV.
 * Checks for existing roles before creation, warns on permission mismatches,
 * and never overwrites existing roles.
 *
 * Usage:
 *   npx tsx bin/process-role-definitions.ts \
 *     --definitions role-definitions.csv
 *
 *   npx tsx bin/process-role-definitions.ts \
 *     --definitions role-definitions.csv \
 *     --org-mapping clerk-org-mapping.csv
 *
 *   npx tsx bin/process-role-definitions.ts \
 *     --definitions role-definitions.csv \
 *     --dry-run
 */

import { Command } from 'commander';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { RoleCache } from '../src/roles/roleCache.js';
import { OrganizationCache } from '../src/cache/organizationCache.js';
import { processRoleDefinitions } from '../src/roles/roleDefinitionsProcessor.js';
import { parseOrgMappingForUniqueOrgs } from '../src/roles/orgMappingReader.js';

const program = new Command();

program
  .name('process-role-definitions')
  .description('Create roles and permissions in WorkOS from a definitions CSV')
  .requiredOption('--definitions <path>', 'Path to role definitions CSV')
  .option('--org-mapping <path>', 'Path to org mapping CSV (for resolving org_external_id to WorkOS org IDs)')
  .option('--dry-run', 'Validate and show what would be created without making API calls')
  .option('--quiet', 'Suppress output messages')
  .option('--report <path>', 'Path for processing report JSON', 'role-definitions-report.json')
  .parse(process.argv);

const opts = program.opts<{
  definitions: string;
  orgMapping?: string;
  dryRun?: boolean;
  quiet?: boolean;
  report: string;
}>();

async function main() {
  const startTime = Date.now();

  if (!opts.quiet) {
    console.log('WorkOS Role Definitions Processor');
    console.log('==================================\n');
  }

  // Validate input file exists
  const definitionsPath = path.resolve(opts.definitions);
  if (!existsSync(definitionsPath)) {
    console.error(`Error: Role definitions CSV not found: ${definitionsPath}`);
    process.exit(1);
  }

  if (!opts.quiet) {
    console.log(`Definitions: ${definitionsPath}`);
    console.log(`Report:      ${path.resolve(opts.report)}`);
    if (opts.dryRun) {
      console.log(`Mode:        DRY RUN`);
    }
    console.log('');
  }

  // Initialize caches
  const dryRun = opts.dryRun ?? false;
  const roleCache = new RoleCache({ dryRun });
  const orgCache = new OrganizationCache({ dryRun });

  // Pre-warm org cache from org mapping if provided
  if (opts.orgMapping) {
    const orgMappingPath = path.resolve(opts.orgMapping);
    if (!existsSync(orgMappingPath)) {
      console.error(`Error: Org mapping CSV not found: ${orgMappingPath}`);
      process.exit(1);
    }

    if (!opts.quiet) {
      console.log(`Org mapping: ${orgMappingPath}`);
      console.log('');
      console.log('Pre-warming org cache from org mapping...');
    }

    const uniqueOrgs = await parseOrgMappingForUniqueOrgs(orgMappingPath);

    let resolved = 0;
    let failed = 0;

    for (const org of uniqueOrgs) {
      try {
        const orgId = await orgCache.resolve({
          orgExternalId: org.orgExternalId,
          createIfMissing: true,
          orgName: org.orgName,
        });
        if (orgId) {
          resolved++;
          if (!opts.quiet) {
            console.log(`  ✓ Resolved org "${org.orgExternalId}" → ${orgId}`);
          }
        } else {
          failed++;
          if (!opts.quiet) {
            console.error(`  ✗ Could not resolve org "${org.orgExternalId}"`);
          }
        }
      } catch (err: any) {
        failed++;
        if (!opts.quiet) {
          console.error(`  ✗ Failed to resolve org "${org.orgExternalId}": ${err?.message}`);
        }
      }
    }

    if (!opts.quiet) {
      console.log(`\nOrg pre-warming: ${resolved} resolved, ${failed} failed (${uniqueOrgs.length} unique orgs)`);
      console.log('');
    }
  }

  try {
    // Process role definitions
    const summary = await processRoleDefinitions({
      csvPath: definitionsPath,
      roleCache,
      orgCache,
      dryRun,
      quiet: opts.quiet,
    });

    // Display summary
    if (!opts.quiet) {
      const duration = Date.now() - startTime;

      console.log('\nProcessing Summary');
      console.log('──────────────────');
      console.log(`Total definitions:      ${summary.total}`);
      console.log(`Created:                ${summary.created}`);
      console.log(`Already exist:          ${summary.alreadyExist}`);
      console.log(`Skipped:                ${summary.skipped}`);
      console.log(`Errors:                 ${summary.errors}`);

      if (summary.warnings.length > 0) {
        console.log(`\nWarnings (${summary.warnings.length}):`);
        for (const warning of summary.warnings) {
          console.log(`  ⚠ ${warning}`);
        }
      }

      // Cache stats
      const cacheStats = roleCache.getStats();
      console.log(`\nCache stats: ${cacheStats.hits} hits, ${cacheStats.misses} misses ` +
        `(${(cacheStats.hitRate * 100).toFixed(1)}% hit rate)`);

      console.log(`\nCompleted in ${duration}ms`);
    }

    // Write report
    const reportPath = path.resolve(opts.report);
    const report = {
      ...summary,
      processedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
      dryRun,
      inputFile: definitionsPath,
    };
    writeFileSync(reportPath, JSON.stringify(report, null, 2));

    if (!opts.quiet) {
      console.log(`Report written to: ${reportPath}`);

      // Next steps
      console.log('\nNext steps:');
      if (dryRun) {
        console.log('  1. Review the report and adjust your CSV if needed');
        console.log('  2. Run again without --dry-run to create roles');
      } else {
        console.log('  1. Verify roles in the WorkOS dashboard');
        console.log('  2. Prepare your user-role mapping CSV');
        console.log('  3. Import users with role assignments');
      }
      console.log('');
    }

    process.exit(summary.errors > 0 ? 1 : 0);
  } catch (err: any) {
    console.error(`\nError: ${err?.message || String(err)}`);
    process.exit(1);
  }
}

main();
