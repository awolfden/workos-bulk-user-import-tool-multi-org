#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import path from "node:path";
import { Auth0Exporter } from "../src/exporters/auth0/auth0Exporter.js";
import { createLogger } from "../src/logger.js";
import type { Auth0Credentials } from "../src/exporters/types.js";

const program = new Command();

program
  .name("workos-export-auth0")
  .description("Export users and organizations from Auth0 to WorkOS CSV format")
  .requiredOption("--domain <domain>", "Auth0 tenant domain (e.g., tenant.auth0.com)")
  .requiredOption("--client-id <id>", "Auth0 Management API client ID")
  .requiredOption("--client-secret <secret>", "Auth0 Management API client secret")
  .requiredOption("--output <path>", "Output CSV file path")
  .option("--audience <url>", "Auth0 API audience (default: https://{domain}/api/v2/)")
  .option("--orgs <ids...>", "Filter to specific organization IDs (space-separated)")
  .option("--page-size <n>", "API page size (default: 100, max: 100)", (v) => parseInt(v, 10))
  .option("--rate-limit <n>", "API rate limit in requests/second (default: 50, Auth0 Free: 2, Developer: 50, Enterprise: 100+)", (v) => parseInt(v, 10))
  .option("--use-metadata", "Use user_metadata instead of Organizations API (for non-Enterprise plans)", false)
  .option("--metadata-org-id-field <field>", "Custom metadata field for org ID (e.g., company_id, tenant_id)")
  .option("--metadata-org-name-field <field>", "Custom metadata field for org name (e.g., company_name, tenant_name)")
  .option("--quiet", "Suppress progress output", false)
  .parse(process.argv);

async function main() {
  const opts = program.opts<{
    domain: string;
    clientId: string;
    clientSecret: string;
    output: string;
    audience?: string;
    orgs?: string[];
    pageSize?: number;
    rateLimit?: number;
    useMetadata?: boolean;
    metadataOrgIdField?: string;
    metadataOrgNameField?: string;
    quiet?: boolean;
  }>();

  const logger = createLogger({ quiet: opts.quiet });

  // Build credentials
  const credentials: Auth0Credentials = {
    type: 'auth0',
    domain: opts.domain,
    clientId: opts.clientId,
    clientSecret: opts.clientSecret,
    audience: opts.audience
  };

  // Create exporter
  const exporter = new Auth0Exporter({
    credentials,
    outputPath: path.resolve(opts.output),
    pageSize: opts.pageSize,
    rateLimit: opts.rateLimit,
    organizationFilter: opts.orgs,
    useMetadata: opts.useMetadata,
    metadataOrgIdField: opts.metadataOrgIdField,
    metadataOrgNameField: opts.metadataOrgNameField,
    quiet: opts.quiet,
    onProgress: (stats) => {
      logger.log(
        `Progress: ${stats.usersProcessed} users, ${stats.orgsProcessed} orgs` +
        (stats.currentOrg ? ` (current: ${stats.currentOrg})` : '')
      );
    }
  });

  try {
    logger.log("Starting Auth0 export...");
    logger.log(`Domain: ${opts.domain}`);
    logger.log(`Output: ${path.resolve(opts.output)}`);

    if (opts.orgs && opts.orgs.length > 0) {
      logger.log(`Filtering to ${opts.orgs.length} organization(s)`);
    }

    logger.log("");

    // Test connection first
    logger.log("Testing Auth0 connection...");
    const validation = await exporter.validate();

    if (!validation.valid) {
      logger.error("Auth0 connection failed:");
      validation.errors.forEach(err => logger.error(`  - ${err}`));
      process.exit(1);
    }

    logger.log("✓ Auth0 connection successful");
    logger.log("");

    // Execute export
    const result = await exporter.export();

    // Print summary
    logger.log("\n" + "=".repeat(60));
    logger.log("Export Complete");
    logger.log("=".repeat(60));
    logger.log(`Output: ${result.outputPath}`);
    logger.log(`Users: ${result.summary.totalUsers}`);
    logger.log(`Organizations: ${result.summary.totalOrgs}`);

    if (result.summary.skippedUsers > 0) {
      logger.warn(`Skipped: ${result.summary.skippedUsers} (users without email or invalid data)`);
    }

    const durationSec = (result.summary.durationMs / 1000).toFixed(2);
    logger.log(`Duration: ${durationSec}s`);

    if (result.summary.totalUsers > 0) {
      const throughput = (result.summary.totalUsers / result.summary.durationMs) * 1000;
      logger.log(`Throughput: ${throughput.toFixed(1)} users/sec`);
    }

    if (result.warnings.length > 0) {
      logger.warn(`\nWarnings (${result.warnings.length}):`);
      result.warnings.slice(0, 10).forEach(w => logger.warn(`  - ${w}`));

      if (result.warnings.length > 10) {
        logger.warn(`  ... and ${result.warnings.length - 10} more`);
      }
    }

    logger.log("=".repeat(60) + "\n");

    logger.log("Next steps:");
    logger.log(`  1. Validate: workos-validate-csv --csv ${path.resolve(opts.output)}`);
    logger.log(`  2. Import: workos-import-users --csv ${path.resolve(opts.output)}`);

    process.exit(0);
  } catch (err: any) {
    logger.error(`\nFatal error: ${err?.message || String(err)}`);

    if (err.stack && !opts.quiet) {
      logger.error("\nStack trace:");
      logger.error(err.stack);
    }

    process.exit(1);
  }
}

main();
