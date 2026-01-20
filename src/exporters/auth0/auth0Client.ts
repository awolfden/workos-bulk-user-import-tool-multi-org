/**
 * Auth0 Management API client wrapper
 * Provides token caching, pagination helpers, and rate limiting
 */

import { ManagementClient } from 'auth0';
import type { Auth0Credentials, Auth0User, Auth0Organization } from '../types.js';
import { RateLimiter } from '../../rateLimiter.js';

export class Auth0Client {
  private client: ManagementClient;
  private credentials: Auth0Credentials;
  private tokenExpiry?: number;
  private rateLimiter: RateLimiter;
  private accessToken?: string;

  constructor(credentials: Auth0Credentials, rateLimit: number = 50) {
    this.credentials = credentials;

    // Initialize Auth0 Management Client
    this.client = new ManagementClient({
      domain: credentials.domain,
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      audience: credentials.audience
    });

    // Initialize rate limiter (default 50 rps for Auth0 Developer tier)
    this.rateLimiter = new RateLimiter(rateLimit);
  }

  /**
   * Get Management API access token
   * Caches token and refreshes when expired
   */
  async getAccessToken(): Promise<string> {
    // Check if we have a valid cached token
    if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    // Fetch new token from Auth0
    const tokenUrl = `https://${this.credentials.domain}/oauth/token`;
    const audience = this.credentials.audience || `https://${this.credentials.domain}/api/v2/`;

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        client_id: this.credentials.clientId,
        client_secret: this.credentials.clientSecret,
        audience,
        grant_type: 'client_credentials'
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get access token: ${error}`);
    }

    const data = await response.json();

    if (!data.access_token) {
      throw new Error('No access token in response');
    }

    this.accessToken = data.access_token;

    // Set expiry with 5 minute buffer
    const expiresIn = data.expires_in || 86400; // Default 24 hours
    this.tokenExpiry = Date.now() + (expiresIn - 300) * 1000;

    return this.accessToken!;
  }

  /**
   * Make a rate-limited API call to Auth0 Management API
   * Automatically handles rate limiting and retries on 429 errors
   */
  async makeApiCall(
    path: string,
    options: RequestInit = {}
  ): Promise<Response> {
    const url = `https://${this.credentials.domain}${path}`;
    const token = await this.getAccessToken();

    return this.retryWithRateLimit(
      async () => {
        const response = await fetch(url, {
          ...options,
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            ...options.headers
          }
        });

        // Throw error for rate limits so retry logic can handle it
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          const error: any = new Error('Rate limit exceeded');
          error.statusCode = 429;
          error.response = {
            headers: { 'retry-after': retryAfter }
          };
          throw error;
        }

        return response;
      },
      5, // Max 5 retries for 429 errors
      2000 // Start with 2 second delay
    );
  }

  /**
   * Retry wrapper with rate limiting and exponential backoff
   * Handles 429 rate limit errors automatically
   */
  private async retryWithRateLimit<T>(
    apiCall: () => Promise<T>,
    maxRetries: number = 3,
    baseDelayMs: number = 1000
  ): Promise<T> {
    let attempt = 0;

    while (true) {
      try {
        // Acquire rate limit token before API call
        await this.rateLimiter.acquire();

        // Execute the API call
        return await apiCall();
      } catch (error: any) {
        const status = error?.statusCode || error?.status || error?.response?.status;
        const message = error?.message || String(error);
        const isRateLimited = status === 429 || /rate.?limit/i.test(message);

        attempt += 1;

        if (isRateLimited && attempt <= maxRetries) {
          // Calculate exponential backoff delay
          let delay = baseDelayMs * Math.pow(2, attempt - 1);

          // Respect Retry-After header if provided
          const retryAfter = error?.response?.headers?.['retry-after'] ||
                            error?.response?.headers?.['Retry-After'];
          if (retryAfter) {
            const retryAfterSeconds = parseInt(retryAfter, 10);
            if (!isNaN(retryAfterSeconds)) {
              delay = retryAfterSeconds * 1000; // Convert to milliseconds
            }
          }

          // Wait before retrying
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        // Not rate limited, or max retries exceeded
        throw error;
      }
    }
  }

  /**
   * Get organizations with pagination
   * @param page Page number (0-indexed)
   * @param perPage Items per page (default: 100, max: 100)
   */
  async getOrganizations(
    page: number = 0,
    perPage: number = 100
  ): Promise<Auth0Organization[]> {
    try {
      const response = await this.retryWithRateLimit(async () => {
        // Auth0 Organizations API uses page and per_page (not from/take)
        return await this.client.organizations.getAll({
          // @ts-ignore - Auth0 SDK types may be outdated
          page,
          per_page: perPage
        });
      });

      // Response can be an array or an object with data property
      const orgs = Array.isArray(response) ? response : response.data || [];

      return orgs.map((org: any) => ({
        id: org.id,
        name: org.name,
        display_name: org.display_name,
        branding: org.branding,
        metadata: org.metadata
      }));
    } catch (error: any) {
      throw new Error(
        `Failed to fetch organizations from Auth0: ${error.message || String(error)}`
      );
    }
  }

  /**
   * Get members of an organization with pagination
   * @param orgId Organization ID
   * @param page Page number (0-indexed)
   * @param perPage Items per page (default: 100, max: 100)
   */
  async getOrganizationMembers(
    orgId: string,
    page: number = 0,
    perPage: number = 100
  ): Promise<Auth0User[]> {
    try {
      const response = await this.retryWithRateLimit(async () => {
        // Auth0 Organizations API uses page and per_page (not from/take)
        // Note: Organization members endpoint returns limited fields
        // Available fields: user_id, email, picture, name, roles
        return await this.client.organizations.getMembers({
          id: orgId,
          // @ts-ignore - Auth0 SDK types may be outdated
          page,
          per_page: perPage
        });
      });

      // Response can be an array or an object with members/data property
      const members = Array.isArray(response)
        ? response
        : (response as any).members || (response as any).data || [];

      return members.map((member: any) => ({
        user_id: member.user_id,
        email: member.email,
        email_verified: member.email_verified,
        name: member.name,
        given_name: member.given_name,
        family_name: member.family_name,
        user_metadata: member.user_metadata,
        app_metadata: member.app_metadata,
        created_at: member.created_at,
        updated_at: member.updated_at
      }));
    } catch (error: any) {
      // If organization not found or no members, return empty array
      if (error.statusCode === 404) {
        return [];
      }

      throw new Error(
        `Failed to fetch members for organization ${orgId}: ${error.message || String(error)}`
      );
    }
  }

  /**
   * Get all users (not organization-specific)
   * Useful for exports without organization context
   * @param page Page number (0-indexed)
   * @param perPage Items per page (default: 100, max: 100)
   */
  async getUsers(
    page: number = 0,
    perPage: number = 100
  ): Promise<Auth0User[]> {
    try {
      const from = page * perPage;

      const response = await this.retryWithRateLimit(async () => {
        return await this.client.users.getAll({
          // @ts-ignore - Auth0 SDK types may be outdated
          from,
          per_page: perPage,
          fields: 'user_id,email,email_verified,name,given_name,family_name,user_metadata,app_metadata,created_at,updated_at',
          include_fields: true
        });
      });

      // Response can be an array or an object with users/data property
      const users = Array.isArray(response)
        ? response
        : (response as any).users || (response as any).data || [];

      return users.map((user: any) => ({
        user_id: user.user_id,
        email: user.email,
        email_verified: user.email_verified,
        name: user.name,
        given_name: user.given_name,
        family_name: user.family_name,
        user_metadata: user.user_metadata,
        app_metadata: user.app_metadata,
        created_at: user.created_at,
        updated_at: user.updated_at
      }));
    } catch (error: any) {
      throw new Error(
        `Failed to fetch users from Auth0: ${error.message || String(error)}`
      );
    }
  }

  /**
   * Get full user details by user ID
   * @param userId User ID
   */
  async getUser(userId: string): Promise<Auth0User | null> {
    try {
      const response = await this.retryWithRateLimit(async () => {
        return await this.client.users.get({
          id: userId
        });
      });

      // Auth0 SDK wraps response in { data, headers, status, statusText }
      const user = response as any;
      const userData = user.data || user;

      return {
        user_id: userData.user_id,
        email: userData.email,
        email_verified: userData.email_verified,
        name: userData.name,
        given_name: userData.given_name,
        family_name: userData.family_name,
        user_metadata: userData.user_metadata || {},
        app_metadata: userData.app_metadata || {},
        created_at: userData.created_at,
        updated_at: userData.updated_at
      };
    } catch (error: any) {
      if (error.statusCode === 404) {
        return null;
      }

      throw new Error(
        `Failed to fetch user ${userId}: ${error.message || String(error)}`
      );
    }
  }

  /**
   * Get user's password hash (requires special Auth0 permission)
   * This is an optional feature and will gracefully fail if not permitted
   * @param userId User ID
   */
  async getUserPasswordHash(
    userId: string
  ): Promise<{ hash?: string; algorithm?: string } | null> {
    try {
      // Note: This requires special "read:user_idp_tokens" scope
      // and may not be available for all Auth0 tenants
      const user = await this.retryWithRateLimit(async () => {
        return await this.client.users.get({
          id: userId
          // @ts-ignore - Password hash fields may not be in types
          // fields: 'password_hash,password_hash_algorithm'
        });
      });

      // @ts-ignore
      if (user.password_hash && user.password_hash_algorithm) {
        return {
          // @ts-ignore
          hash: user.password_hash,
          // @ts-ignore
          algorithm: user.password_hash_algorithm
        };
      }

      return null;
    } catch (error: any) {
      // Password export not permitted - return null (not an error)
      if (error.statusCode === 403) {
        return null;
      }

      throw new Error(
        `Failed to fetch password hash for user ${userId}: ${error.message || String(error)}`
      );
    }
  }

  /**
   * Test connection to Auth0
   * Verifies credentials are valid
   */
  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      // Try fetching first page of organizations as a connection test
      await this.getOrganizations(0, 1);
      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || String(error)
      };
    }
  }

  /**
   * Stop the rate limiter
   * Call this when done with the client to clean up timers
   */
  stop(): void {
    this.rateLimiter.stop();
  }
}
