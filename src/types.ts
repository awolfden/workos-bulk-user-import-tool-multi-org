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
  errorType?: "user_create" | "membership_create";
  errorMessage: string;
  timestamp: string;
  rawRow?: Record<string, unknown>;
  httpStatus?: number;
  workosCode?: string;
  workosRequestId?: string;
  workosErrors?: unknown;
};

export type ImportSummary = {
  total: number;
  successes: number;
  failures: number;
  membershipsCreated: number;
  startedAt: number;
  endedAt: number;
  warnings: string[];
};

