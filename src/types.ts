export type CSVRow = {
  email?: string;
  password?: string;
  password_hash?: string;
  password_hash_type?: string;
  first_name?: string;
  last_name?: string;
  email_verified?: string | boolean;
  external_id?: string;
  metadata?: string;
  // Organization fields (multi-org mode)
  org_id?: string;
  org_external_id?: string;
  org_name?: string;
  // Allow unknowns; they will be ignored with a once-only warning
  [key: string]: unknown;
};

export type CreateUserPayload = {
  email: string;
  firstName?: string;
  lastName?: string;
  password?: string;
  passwordHash?: string;
  passwordHashType?: string;
  emailVerified?: boolean;
  externalId?: string;
  metadata?: Record<string, unknown>;
};

export type ErrorRecord = {
  recordNumber: number;
  email?: string;
  userId?: string;
  errorType?: "user_create" | "membership_create" | "org_resolution";
  errorMessage: string;
  timestamp: string;
  rawRow?: Record<string, unknown>;
  httpStatus?: number;
  workosCode?: string;
  workosRequestId?: string;
  workosErrors?: unknown;
  // Organization context (for org_resolution and membership_create errors)
  orgId?: string;
  orgExternalId?: string;
};

export type ImportSummary = {
  total: number;
  successes: number;
  failures: number;
  membershipsCreated: number;
  startedAt: number;
  endedAt: number;
  warnings: string[];
  // Cache statistics (multi-org mode only)
  cacheStats?: {
    hits: number;
    misses: number;
    hitRate: string; // formatted as percentage
  };
};

