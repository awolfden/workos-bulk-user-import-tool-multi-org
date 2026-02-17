/**
 * Auth0 Exporter
 * Exports users and organizations from Auth0 to WorkOS-compatible CSV format
 * Uses streaming to handle large datasets without memory issues
 * Supports checkpointing for resumable exports
 */

import { createWriteStream, WriteStream } from 'node:fs';
import fs from 'node:fs';
import type {
  ExporterConfig,
  ExportResult,
  Auth0Credentials,
  BaseExporter
} from '../types.js';
import { Auth0Client } from './auth0Client.js';
import { mapAuth0UserToWorkOS, validateMappedRow } from './auth0Mapper.js';
import { ExportCheckpointManager } from '../checkpoint/exportCheckpointManager.js';
import { ExportProgressUI } from '../../ui/exportProgressUI.js';

export class Auth0Exporter implements BaseExporter {
  private client: Auth0Client;
  private config: ExporterConfig;
  private checkpointManager?: ExportCheckpointManager;
  private progressUI: ExportProgressUI;
  private skippedUsersStream?: WriteStream;
  private exportStartTime: number = 0;

  constructor(config: ExporterConfig) {
    if (config.credentials.type !== 'auth0') {
      throw new Error('Auth0Exporter requires Auth0 credentials');
    }

    this.config = config;
    const rateLimit = config.rateLimit ?? 50; // Default 50 rps for Auth0 Developer tier
    this.client = new Auth0Client(config.credentials as Auth0Credentials, rateLimit);
    this.progressUI = new ExportProgressUI(config.quiet);
  }

  /**
   * Export users and organizations from Auth0 to CSV
   */
  async export(): Promise<ExportResult> {
    const startTime = Date.now();
    this.exportStartTime = startTime;
    const warnings: string[] = [];
    let totalUsers = 0;
    let totalOrgs = 0;
    let skippedUsers = 0;
    let isResume = false;

    // Handle checkpoint resume or creation
    if (this.config.resume) {
      const resumeJobId = typeof this.config.resume === 'string'
        ? this.config.resume
        : this.config.jobId;

      if (!resumeJobId) {
        throw new Error('Resume requires a jobId (provide via --job-id or --resume <jobId>)');
      }

      if (!ExportCheckpointManager.exists(resumeJobId, this.config.checkpointDir)) {
        throw new Error(`No checkpoint found for job ID: ${resumeJobId}`);
      }

      this.checkpointManager = await ExportCheckpointManager.resume(
        { jobId: resumeJobId, checkpointDir: this.config.checkpointDir },
        this.config.credentials as Auth0Credentials
      );

      isResume = true;

      const completed = this.checkpointManager.getCompletedOrganizations();
      const pending = this.checkpointManager.getPendingOrganizations();
      this.progressUI.logCheckpointResume(resumeJobId, completed.length, pending.length);
    }

    // Determine write stream mode (append for resume, write for new)
    const writeMode = isResume && fs.existsSync(this.config.outputPath);
    const writeStream = createWriteStream(this.config.outputPath, {
      encoding: 'utf-8',
      flags: writeMode ? 'a' : 'w'  // Append if resuming, write if new
    });

    // Create skipped users log file
    const skippedUsersPath = this.config.outputPath.replace('.csv', '-skipped.jsonl');
    this.skippedUsersStream = createWriteStream(skippedUsersPath, {
      encoding: 'utf-8',
      flags: writeMode ? 'a' : 'w'
    });

    try {
      // Write CSV header only if not resuming
      if (!writeMode) {
        this.writeHeader(writeStream);
      }

      // Choose export mode: metadata-based or organization-based
      const exportStats = this.config.useMetadata
        ? await this.exportUsersWithMetadata(writeStream, warnings)
        : await this.exportOrganizations(writeStream, warnings);

      totalUsers = exportStats.totalUsers;
      totalOrgs = exportStats.totalOrgs;
      skippedUsers = exportStats.skippedUsers;

      // Close write stream
      await this.closeStream(writeStream);

      // Close skipped users stream
      if (this.skippedUsersStream) {
        await this.closeStream(this.skippedUsersStream);
      }

      // Mark checkpoint as completed
      if (this.checkpointManager) {
        await this.checkpointManager.complete();
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Stop rate limiter
      this.client.stop();

      // Display final summary
      const throughput = totalUsers / (duration / 1000);
      const failedOrgs = this.checkpointManager
        ? this.checkpointManager.getFailedOrganizations().length
        : 0;

      this.progressUI.displaySummary({
        totalOrgs,
        completedOrgs: totalOrgs - failedOrgs,
        failedOrgs,
        totalUsers,
        skippedUsers,
        duration,
        throughput,
        warnings: warnings.length
      });

      // Log skipped users file location if any users were skipped
      if (skippedUsers > 0 && !this.config.quiet) {
        console.log(`\nℹ Skipped users logged to: ${skippedUsersPath}`);
      }

      return {
        outputPath: this.config.outputPath,
        summary: {
          totalUsers,
          totalOrgs,
          skippedUsers,
          startedAt: startTime,
          endedAt: endTime,
          durationMs: duration
        },
        warnings
      };
    } catch (error: any) {
      // Ensure stream is closed on error
      writeStream.end();

      // Mark checkpoint as failed
      if (this.checkpointManager) {
        await this.checkpointManager.fail(error.message || String(error));
      }

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

    this.progressUI.logInfo(`Found ${totalOrgs} organizations`);

    // Step 1.5: Create checkpoint if jobId provided and not resuming
    if (this.config.jobId && !this.checkpointManager) {
      this.checkpointManager = await ExportCheckpointManager.create(
        this.config.jobId,
        this.config.outputPath,
        this.config.credentials as Auth0Credentials,
        organizations.map(org => ({ id: org.id, name: org.name })),
        {
          useMetadata: this.config.useMetadata,
          organizationFilter: this.config.organizationFilter,
          checkpointDir: this.config.checkpointDir
        }
      );

      this.progressUI.logCheckpointCreated(this.config.jobId);
    }

    // Initialize progress bars
    this.progressUI.startExport(totalOrgs);

    // Get completed organizations (for resume)
    const completedOrgIds = new Set(
      this.checkpointManager
        ? this.checkpointManager.getCompletedOrganizations().map(o => o.orgId)
        : []
    );

    // Step 2: For each organization, export users
    for (const org of organizations) {
      // Skip if organizationFilter is set and org not in filter
      if (
        this.config.organizationFilter &&
        !this.config.organizationFilter.includes(org.id)
      ) {
        continue;
      }

      // Skip if already completed (resume scenario)
      if (completedOrgIds.has(org.id)) {
        this.progressUI.logOrgSkipped(org.name);
        continue;
      }

      // Mark organization as in progress
      if (this.checkpointManager) {
        await this.checkpointManager.startOrganization(org.id);
      }

      // Fetch and export users for this organization
      let orgPage = 0;
      let hasMoreUsers = true;
      let orgUserCount = 0;
      let orgSkippedUsers = 0;

      try {
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

          // Process and write users in batches for parallel fetching
          // Note: Organization members API only returns basic fields (user_id, email, name)
          // We need to fetch full user details to get metadata, email_verified, etc.
          const batchSize = this.config.userFetchConcurrency ?? 10;

          for (let i = 0; i < users.length; i += batchSize) {
            const batch = users.slice(i, i + batchSize);

            // Fetch full user details in parallel (rate limiter controls actual concurrency)
            const userFetchResults = await Promise.allSettled(
              batch.map(async (member) => {
                const memberId = (member as any).user_id;

                if (!memberId) {
                  return {
                    success: false,
                    error: 'No user_id in member object',
                    memberId: undefined
                  };
                }

                try {
                  const fullUser = await this.client.getUser(memberId);
                  return {
                    success: true,
                    user: fullUser,
                    memberId
                  };
                } catch (error: any) {
                  return {
                    success: false,
                    error: error.message || String(error),
                    memberId
                  };
                }
              })
            );

            // Process batch results
            for (const result of userFetchResults) {
              if (result.status === 'rejected') {
                const reason = 'Promise rejected';
                const error = String(result.reason);
                this.logSkippedUser(undefined, undefined, org.id, org.name, reason, error);
                warnings.push(
                  `Skipped user in org ${org.name}: ${reason} - ${error}`
                );
                orgSkippedUsers++;
                continue;
              }

              const fetchResult = result.value;

              if (!fetchResult.success) {
                const reason = 'Failed to fetch user details';
                this.logSkippedUser(
                  fetchResult.memberId,
                  undefined,
                  org.id,
                  org.name,
                  reason,
                  fetchResult.error
                );
                warnings.push(
                  `Skipped user ${fetchResult.memberId || 'unknown'} in org ${org.name}: ${fetchResult.error}`
                );
                orgSkippedUsers++;
                continue;
              }

              const fullUser = fetchResult.user;

              if (!fullUser) {
                const reason = 'User not found';
                this.logSkippedUser(fetchResult.memberId, undefined, org.id, org.name, reason);
                warnings.push(
                  `Skipped user ${fetchResult.memberId} in org ${org.name}: ${reason}`
                );
                orgSkippedUsers++;
                continue;
              }

              if (!fullUser.email) {
                const reason = 'No email address';
                this.logSkippedUser(
                  fullUser.user_id || fetchResult.memberId,
                  undefined,
                  org.id,
                  org.name,
                  reason
                );
                warnings.push(
                  `Skipped user ${fullUser.user_id || fetchResult.memberId} in org ${org.name}: ${reason}`
                );
                orgSkippedUsers++;
                continue;
              }

              // Map Auth0 user to WorkOS CSV row
              const csvRow = mapAuth0UserToWorkOS(fullUser, org);

              // Validate row
              const validationError = validateMappedRow(csvRow);
              if (validationError) {
                const reason = 'Validation failed';
                this.logSkippedUser(
                  fullUser.user_id,
                  fullUser.email,
                  org.id,
                  org.name,
                  reason,
                  validationError
                );
                warnings.push(
                  `Skipped user ${fullUser.user_id} in org ${org.name}: ${validationError}`
                );
                orgSkippedUsers++;
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
                // Calculate estimated total and remaining time
                const elapsedMs = Date.now() - this.exportStartTime;

                // Get current org index to estimate completion
                let completedOrgCount = 0;
                for (let i = 0; i < organizations.length; i++) {
                  if (organizations[i]?.id === org.id) {
                    completedOrgCount = i;
                    break;
                  }
                }

                const estimatedTotal = completedOrgCount > 0
                  ? Math.ceil((totalUsers / completedOrgCount) * totalOrgs)
                  : undefined;

                const estimatedRemainingMs = this.calculateRemainingTime(
                  totalUsers,
                  estimatedTotal,
                  elapsedMs
                );

                this.config.onProgress({
                  usersProcessed: totalUsers,
                  orgsProcessed: totalOrgs,
                  currentOrg: org.name,
                  estimatedTotal,
                  elapsedMs,
                  estimatedRemainingMs
                });
              }
            }
          }

          // Check if there are more pages
          if (users.length < (this.config.pageSize ?? 100)) {
            hasMoreUsers = false;
          } else {
            orgPage++;
          }
        }

        // Mark organization as completed
        if (this.checkpointManager) {
          await this.checkpointManager.completeOrganization(
            org.id,
            orgUserCount,
            orgSkippedUsers
          );
        }

        // Update global counters
        skippedUsers += orgSkippedUsers;
        const completedOrgs = this.checkpointManager
          ? this.checkpointManager.getCompletedOrganizations().length
          : 0;

        // Calculate estimated total users based on current progress
        // This gives us a dynamic estimate that improves as we process more orgs
        const estimatedTotalUsers = completedOrgs > 0
          ? Math.ceil((totalUsers / completedOrgs) * totalOrgs)
          : undefined;

        // Update progress and log completion
        this.progressUI.updateProgress(completedOrgs, totalUsers, estimatedTotalUsers);
        this.progressUI.logOrgComplete(org.name, orgUserCount, orgSkippedUsers);
      } catch (error: any) {
        // Mark organization as failed
        if (this.checkpointManager) {
          await this.checkpointManager.failOrganization(
            org.id,
            error.message || String(error)
          );
        }

        const errorMsg = error.message || String(error);
        warnings.push(`Failed to export org ${org.name}: ${errorMsg}`);

        // Log failure
        this.progressUI.logOrgFailed(org.name, errorMsg);

        // Continue with next organization instead of failing entire export
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

    this.progressUI.logInfo('Using metadata-based export (Organizations API not available)');

    // Initialize progress (can't show org count upfront in metadata mode)
    this.progressUI.startExport(0);

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
          const reason = 'No organization info in metadata';
          this.logSkippedUser(user.user_id, user.email, undefined, undefined, reason);
          warnings.push(
            `Skipped user ${user.user_id || user.email}: ${reason}`
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
          const reason = 'Validation failed';
          this.logSkippedUser(
            user.user_id,
            user.email,
            orgInfo.orgId,
            orgInfo.orgName,
            reason,
            validationError
          );
          warnings.push(
            `Skipped user ${user.user_id} in org ${orgInfo.orgName}: ${validationError}`
          );
          skippedUsers++;
          continue;
        }

        // Write row to CSV
        this.writeRow(writeStream, csvRow);
        totalUsers++;

        // Update progress every 100 users
        if (totalUsers % 100 === 0) {
          this.progressUI.updateUserProgress(totalUsers);

          // Also call callback if provided
          if (this.config.onProgress) {
            this.config.onProgress({
              usersProcessed: totalUsers,
              orgsProcessed: orgSet.size,
              currentOrg: orgInfo.orgName,
              elapsedMs: Date.now()
            });
          }
        }
      }

      if (users.length < (this.config.pageSize ?? 100)) {
        hasMoreUsers = false;
      } else {
        page++;
      }
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
   * Calculate estimated remaining time
   */
  private calculateRemainingTime(
    usersProcessed: number,
    estimatedTotal: number | undefined,
    elapsedMs: number
  ): number | undefined {
    if (!estimatedTotal || estimatedTotal <= usersProcessed || elapsedMs < 5000) {
      return undefined; // Need at least 5 seconds of data
    }

    const throughput = usersProcessed / (elapsedMs / 1000); // users per second
    if (throughput < 0.1) {
      return undefined; // Too slow to calculate
    }

    const remainingUsers = estimatedTotal - usersProcessed;
    const remainingSeconds = remainingUsers / throughput;
    return Math.ceil(remainingSeconds * 1000); // Convert to milliseconds
  }

  /**
   * Log a skipped user to the skipped users file
   */
  private logSkippedUser(
    userId: string | undefined,
    email: string | undefined,
    orgId: string | undefined,
    orgName: string | undefined,
    reason: string,
    error?: string
  ): void {
    if (!this.skippedUsersStream) {
      return;
    }

    const logEntry = {
      timestamp: new Date().toISOString(),
      user_id: userId || 'unknown',
      email: email || 'unknown',
      org_id: orgId || 'unknown',
      org_name: orgName || 'unknown',
      reason,
      error
    };

    this.skippedUsersStream.write(JSON.stringify(logEntry) + '\n');
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
