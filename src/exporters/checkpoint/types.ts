/**
 * Export Checkpoint Types
 * Enables resumable exports for large-scale Auth0 migrations
 */

export interface ExportCheckpointState {
  jobId: string;
  csvPath: string;
  createdAt: number;
  updatedAt: number;

  // Export configuration (for validation on resume)
  config: {
    domain: string;
    credentialsHash: string;  // SHA-256 hash of credentials for validation
    useMetadata: boolean;
    organizationFilter?: string[];
  };

  // Progress tracking
  organizations: OrganizationProgress[];
  summary: ExportSummary;

  // State
  status: 'in_progress' | 'completed' | 'failed';
  error?: string;
}

export interface OrganizationProgress {
  orgId: string;
  orgName: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  usersExported: number;
  usersSkipped: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
}

export interface ExportSummary {
  totalOrgs: number;
  completedOrgs: number;
  failedOrgs: number;
  totalUsers: number;
  skippedUsers: number;
  warnings: string[];
}

export interface ResumeOptions {
  jobId: string;
  checkpointDir?: string;
}
