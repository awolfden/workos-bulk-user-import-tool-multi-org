import { getWorkOSClient, getWorkOSApiKey } from '../workos.js';

const WORKOS_BASE_URL = 'https://api.workos.com';

/** Role object returned from the WorkOS API */
export interface Role {
  id: string;
  slug: string;
  name: string;
  description?: string;
  type: 'EnvironmentRole' | 'OrganizationRole';
  permissions: string[];
}

/** List all roles for an organization (environment + org-specific) */
export async function listRolesForOrganization(
  organizationId: string
): Promise<Role[]> {
  const workos = getWorkOSClient();
  const roles: Role[] = [];

  let after: string | undefined;
  // Paginate through all roles
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const response = await (workos as any).organizations.listOrganizationRoles({
      organizationId,
      after,
      limit: 100,
    });

    const data = response?.data ?? [];
    for (const role of data) {
      roles.push({
        id: role.id,
        slug: role.slug,
        name: role.name,
        description: role.description,
        type: role.type,
        permissions: role.permissions ?? [],
      });
    }

    // Check for next page
    const listMeta = response?.listMetadata ?? response?.list_metadata;
    if (!listMeta?.after) break;
    after = listMeta.after;
  }

  return roles;
}

/** Create an environment-level role via direct REST call */
export async function createEnvironmentRole(options: {
  name: string;
  slug: string;
  description?: string;
}): Promise<Role> {
  return retryApiCall(async () => {
    const apiKey = getWorkOSApiKey();
    const body: Record<string, unknown> = {
      name: options.name,
      slug: options.slug,
    };
    if (options.description) {
      body.description = options.description;
    }

    const response = await fetch(`${WORKOS_BASE_URL}/authorization/roles`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      const err = new Error(
        `Failed to create environment role "${options.slug}": ${response.status} ${errorBody}`
      );
      (err as any).status = response.status;
      throw err;
    }

    const data = await response.json() as any;
    return {
      id: data.id,
      slug: data.slug,
      name: data.name,
      description: data.description,
      type: 'EnvironmentRole' as const,
      permissions: data.permissions ?? [],
    };
  });
}

/** Create an organization-level role via direct REST call */
export async function createOrganizationRole(options: {
  organizationId: string;
  name: string;
  slug: string;
  description?: string;
}): Promise<Role> {
  return retryApiCall(async () => {
    const apiKey = getWorkOSApiKey();
    const body: Record<string, unknown> = {
      name: options.name,
      slug: options.slug,
    };
    if (options.description) {
      body.description = options.description;
    }

    const response = await fetch(
      `${WORKOS_BASE_URL}/authorization/organizations/${options.organizationId}/roles`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      const err = new Error(
        `Failed to create org role "${options.slug}" for org ${options.organizationId}: ${response.status} ${errorBody}`
      );
      (err as any).status = response.status;
      throw err;
    }

    const data = await response.json() as any;
    return {
      id: data.id,
      slug: data.slug,
      name: data.name,
      description: data.description,
      type: 'OrganizationRole' as const,
      permissions: data.permissions ?? [],
    };
  });
}

/** Create a permission via direct REST call. Returns true if created, false if already exists. */
export async function createPermission(options: {
  slug: string;
  name: string;
  description?: string;
}): Promise<boolean> {
  return retryApiCall(async () => {
    const apiKey = getWorkOSApiKey();
    const body: Record<string, unknown> = {
      slug: options.slug,
      name: options.name,
    };
    if (options.description) {
      body.description = options.description;
    }

    const response = await fetch(`${WORKOS_BASE_URL}/authorization/permissions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      // 409 or similar = already exists
      if (response.status === 409 || errorBody.includes('already exists') || errorBody.includes('already been taken')) {
        return false;
      }
      const err = new Error(
        `Failed to create permission "${options.slug}": ${response.status} ${errorBody}`
      );
      (err as any).status = response.status;
      throw err;
    }

    return true;
  });
}

/** Set all permissions on an environment role (replaces existing permissions) */
export async function assignPermissionsToEnvironmentRole(options: {
  roleSlug: string;
  permissions: string[];
}): Promise<void> {
  return retryApiCall(async () => {
    const apiKey = getWorkOSApiKey();

    const response = await fetch(
      `${WORKOS_BASE_URL}/authorization/roles/${options.roleSlug}/permissions`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ permissions: options.permissions }),
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      const err = new Error(
        `Failed to assign permissions to environment role "${options.roleSlug}": ${response.status} ${errorBody}`
      );
      (err as any).status = response.status;
      throw err;
    }
  });
}

/** Set all permissions on an organization role (replaces existing permissions) */
export async function assignPermissionsToOrganizationRole(options: {
  organizationId: string;
  roleSlug: string;
  permissions: string[];
}): Promise<void> {
  return retryApiCall(async () => {
    const apiKey = getWorkOSApiKey();

    const response = await fetch(
      `${WORKOS_BASE_URL}/authorization/organizations/${options.organizationId}/roles/${options.roleSlug}/permissions`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ permissions: options.permissions }),
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      const err = new Error(
        `Failed to assign permissions to org role "${options.roleSlug}" in org ${options.organizationId}: ${response.status} ${errorBody}`
      );
      (err as any).status = response.status;
      throw err;
    }
  });
}

/** Retry wrapper with exponential backoff for rate limiting */
async function retryApiCall<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelayMs = 500
): Promise<T> {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fn();
    } catch (err: any) {
      const status: number | undefined =
        err?.status ?? err?.httpStatus ?? err?.response?.status;
      const message: string = err?.message || 'Unknown error';
      const isRateLimited = status === 429 || /rate.?limit/i.test(message);

      attempt += 1;
      if (isRateLimited && attempt <= maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
}
