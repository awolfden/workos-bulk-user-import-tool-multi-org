/**
 * Auth0 Exporter
 * Exports users and organizations from Auth0 to WorkOS-compatible CSV format
 * Uses streaming to handle large datasets without memory issues
 */

import { createWriteStream, WriteStream } from 'node:fs';
import type {
  ExporterConfig,
  ExportResult,
  Auth0Credentials,
  BaseExporter
} from '../types.js';
import { Auth0Client } from './auth0Client.js';
import { mapAuth0UserToWorkOS, validateMappedRow } from './auth0Mapper.js';

export class Auth0Exporter implements BaseExporter {
  private client: Auth0Client;
  private config: ExporterConfig;

  constructor(config: ExporterConfig) {
    if (config.credentials.type !== 'auth0') {
      throw new Error('Auth0Exporter requires Auth0 credentials');
    }

    this.config = config;
    const rateLimit = config.rateLimit ?? 50; // Default 50 rps for Auth0 Developer tier
    this.client = new Auth0Client(config.credentials as Auth0Credentials, rateLimit);
  }

  /**
   * Export users and organizations from Auth0 to CSV
   */
  async export(): Promise<ExportResult> {
    const startTime = Date.now();
    const warnings: string[] = [];
    let totalUsers = 0;
    let totalOrgs = 0;
    let skippedUsers = 0;

    // Create write stream
    const writeStream = createWriteStream(this.config.outputPath, {
      encoding: 'utf-8'
    });

    try {
      // Write CSV header
      this.writeHeader(writeStream);

      // Choose export mode: metadata-based or organization-based
      const exportStats = this.config.useMetadata
        ? await this.exportUsersWithMetadata(writeStream, warnings)
        : await this.exportOrganizations(writeStream, warnings);

      totalUsers = exportStats.totalUsers;
      totalOrgs = exportStats.totalOrgs;
      skippedUsers = exportStats.skippedUsers;

      // Close write stream
      await this.closeStream(writeStream);

      const endTime = Date.now();

      // Stop rate limiter
      this.client.stop();

      return {
        outputPath: this.config.outputPath,
        summary: {
          totalUsers,
          totalOrgs,
          skippedUsers,
          startedAt: startTime,
          endedAt: endTime,
          durationMs: endTime - startTime
        },
        warnings
      };
    } catch (error: any) {
      // Ensure stream is closed on error
      writeStream.end();

      // Stop rate limiter
      this.client.stop();

      throw new Error(
        `Export failed: ${error.message || String(error)}`
      );
    }
  }

  /**
   * Validate connection to Auth0
   */
  async validate(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    try {
      const result = await this.client.testConnection();

      if (!result.success) {
        errors.push(result.error || 'Connection test failed');
      }

      return { valid: errors.length === 0, errors };
    } catch (error: any) {
      errors.push(error.message || String(error));
      return { valid: false, errors };
    }
  }

  /**
   * Export all organizations and their users
   */
  private async exportOrganizations(
    writeStream: WriteStream,
    warnings: string[]
  ): Promise<{
    totalUsers: number;
    totalOrgs: number;
    skippedUsers: number;
  }> {
    let totalUsers = 0;
    let totalOrgs = 0;
    let skippedUsers = 0;

    // Step 1: Fetch all organizations
    const organizations = await this.fetchAllOrganizations();
    totalOrgs = organizations.length;

    if (!this.config.quiet) {
      console.log(`Found ${totalOrgs} organizations`);
    }

    // Step 2: For each organization, export users
    for (const org of organizations) {
      // Skip if organizationFilter is set and org not in filter
      if (
        this.config.organizationFilter &&
        !this.config.organizationFilter.includes(org.id)
      ) {
        continue;
      }

      // Fetch and export users for this organization
      let orgPage = 0;
      let hasMoreUsers = true;
      let orgUserCount = 0;

      while (hasMoreUsers) {
        const users = await this.client.getOrganizationMembers(
          org.id,
          orgPage,
          this.config.pageSize ?? 100
        );

        if (users.length === 0) {
          hasMoreUsers = false;
          break;
        }

        // Process and write users
        // Note: Organization members API only returns basic fields (user_id, email, name)
        // We need to fetch full user details to get metadata, email_verified, etc.
        for (const member of users) {
          const memberId = (member as any).user_id;

          if (!memberId) {
            warnings.push(
              `Skipped user in org ${org.name}: No user_id in member object`
            );
            skippedUsers++;
            continue;
          }

          // Fetch full user details
          const fullUser = await this.client.getUser(memberId);

          if (!fullUser) {
            warnings.push(
              `Skipped user ${memberId} in org ${org.name}: User not found`
            );
            skippedUsers++;
            continue;
          }

          if (!fullUser.email) {
            warnings.push(
              `Skipped user ${fullUser.user_id || memberId} in org ${org.name}: No email address`
            );
            skippedUsers++;
            continue;
          }

          // Map Auth0 user to WorkOS CSV row
          const csvRow = mapAuth0UserToWorkOS(fullUser, org);

          // Validate row
          const validationError = validateMappedRow(csvRow);
          if (validationError) {
            warnings.push(
              `Skipped user ${fullUser.user_id} in org ${org.name}: ${validationError}`
            );
            skippedUsers++;
            continue;
          }

          // Write row to CSV
          this.writeRow(writeStream, csvRow);
          totalUsers++;
          orgUserCount++;

          // Progress callback every 100 users
          if (
            this.config.onProgress &&
            totalUsers % 100 === 0
          ) {
            this.config.onProgress({
              usersProcessed: totalUsers,
              orgsProcessed: totalOrgs,
              currentOrg: org.name,
              elapsedMs: Date.now() - Date.now()
            });
          }
        }

        // Check if there are more pages
        if (users.length < (this.config.pageSize ?? 100)) {
          hasMoreUsers = false;
        } else {
          orgPage++;
        }
      }

      if (!this.config.quiet && orgUserCount > 0) {
        console.log(
          `  Exported ${orgUserCount} users from ${org.name}`
        );
      }
    }

    return { totalUsers, totalOrgs, skippedUsers };
  }

  /**
   * Fetch all organizations with pagination
   */
  private async fetchAllOrganizations() {
    const allOrgs = [];
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const orgs = await this.client.getOrganizations(
        page,
        this.config.pageSize ?? 100
      );

      if (orgs.length === 0) {
        hasMore = false;
        break;
      }

      allOrgs.push(...orgs);

      if (orgs.length < (this.config.pageSize ?? 100)) {
        hasMore = false;
      } else {
        page++;
      }
    }

    return allOrgs;
  }

  /**
   * Export users using metadata-based organization info
   * For Auth0 tenants without Organizations API access
   */
  private async exportUsersWithMetadata(
    writeStream: WriteStream,
    warnings: string[]
  ): Promise<{
    totalUsers: number;
    totalOrgs: number;
    skippedUsers: number;
  }> {
    let totalUsers = 0;
    let skippedUsers = 0;
    const orgSet = new Set<string>();

    if (!this.config.quiet) {
      console.log('Using metadata-based export (Organizations API not available)');
    }

    // Fetch all users with pagination
    let page = 0;
    let hasMoreUsers = true;

    while (hasMoreUsers) {
      const users = await this.client.getUsers(
        page,
        this.config.pageSize ?? 100
      );

      if (users.length === 0) {
        hasMoreUsers = false;
        break;
      }

      // Process each user
      for (const user of users) {
        // Extract org info from metadata using custom or default field names
        const { extractOrgFromMetadata } = await import('./auth0Mapper.js');
        const orgInfo = extractOrgFromMetadata(
          user,
          this.config.metadataOrgIdField,
          this.config.metadataOrgNameField
        );

        if (!orgInfo || !orgInfo.orgId || !orgInfo.orgName) {
          warnings.push(
            `Skipped user ${user.user_id || user.email}: No organization info in metadata`
          );
          skippedUsers++;
          continue;
        }

        // Filter by organization if specified
        if (
          this.config.organizationFilter &&
          !this.config.organizationFilter.includes(orgInfo.orgId)
        ) {
          continue;
        }

        // Track unique orgs
        orgSet.add(orgInfo.orgId);

        // Map user to CSV row
        const { mapAuth0UserToWorkOS } = await import('./auth0Mapper.js');
        const mockOrg = {
          id: orgInfo.orgId,
          name: orgInfo.orgName,
          display_name: orgInfo.orgName
        };
        const csvRow = mapAuth0UserToWorkOS(user, mockOrg);

        // Validate row
        const { validateMappedRow } = await import('./auth0Mapper.js');
        const validationError = validateMappedRow(csvRow);
        if (validationError) {
          warnings.push(
            `Skipped user ${user.user_id} in org ${orgInfo.orgName}: ${validationError}`
          );
          skippedUsers++;
          continue;
        }

        // Write row to CSV
        this.writeRow(writeStream, csvRow);
        totalUsers++;

        // Progress callback every 100 users
        if (
          this.config.onProgress &&
          totalUsers % 100 === 0
        ) {
          this.config.onProgress({
            usersProcessed: totalUsers,
            orgsProcessed: orgSet.size,
            currentOrg: orgInfo.orgName,
            elapsedMs: Date.now()
          });
        }
      }

      if (users.length < (this.config.pageSize ?? 100)) {
        hasMoreUsers = false;
      } else {
        page++;
      }
    }

    if (!this.config.quiet) {
      console.log(`\nExported ${totalUsers} users from ${orgSet.size} organizations (via metadata)`);
    }

    return { totalUsers, totalOrgs: orgSet.size, skippedUsers };
  }

  /**
   * Write CSV header
   * Column order matches WorkOS import expectations
   */
  private writeHeader(writeStream: WriteStream): void {
    const header = [
      'email',
      'first_name',
      'last_name',
      'email_verified',
      'external_id',
      'org_external_id',
      'org_name',
      'metadata'
    ];

    writeStream.write(header.join(',') + '\n');
  }

  /**
   * Write a CSV row
   * Handles proper escaping of values
   * Column order matches WorkOS import expectations
   */
  private writeRow(writeStream: WriteStream, row: any): void {
    const columns = [
      'email',
      'first_name',
      'last_name',
      'email_verified',
      'external_id',
      'org_external_id',
      'org_name',
      'metadata'
    ];

    const values = columns.map(col => {
      const value = row[col];

      if (value === undefined || value === null) {
        return '';
      }

      // Convert boolean to string
      if (typeof value === 'boolean') {
        return value ? 'true' : 'false';
      }

      // Convert to string
      const strValue = String(value);

      // Escape CSV value if it contains special characters
      return this.escapeCsvValue(strValue);
    });

    writeStream.write(values.join(',') + '\n');
  }

  /**
   * Escape CSV value
   * Wraps in quotes if contains comma, newline, or quote
   */
  private escapeCsvValue(value: string): string {
    // If value contains comma, newline, carriage return, or quote
    if (/[,"\n\r]/.test(value)) {
      // Escape quotes by doubling them
      const escaped = value.replace(/"/g, '""');
      return `"${escaped}"`;
    }

    return value;
  }

  /**
   * Close write stream
   */
  private async closeStream(writeStream: WriteStream): Promise<void> {
    return new Promise((resolve, reject) => {
      writeStream.end((err: Error | null | undefined) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}
