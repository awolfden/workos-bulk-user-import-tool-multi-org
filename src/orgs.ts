import { WorkOS } from "@workos-inc/node";
import { getWorkOSClient } from "./workos.js";

export async function getOrganizationById(orgId: string): Promise<boolean> {
  const workos = getWorkOSClient() as WorkOS;
  try {
    const org = await (workos as any).organizations.getOrganization(orgId);
    return Boolean(org?.id);
  } catch (err: any) {
    const status: number | undefined =
      err?.status ?? err?.httpStatus ?? err?.response?.status ?? err?.code;
    if (status === 404) return false;
    throw err;
  }
}

export async function getOrganizationByExternalId(externalId: string): Promise<string | null> {
  const workos = getWorkOSClient() as WorkOS;
  try {
    const org = await (workos as any).organizations.getOrganizationByExternalId(externalId);
    return org?.id ?? null;
  } catch (err: any) {
    const status: number | undefined =
      err?.status ?? err?.httpStatus ?? err?.response?.status ?? err?.code;
    if (status === 404) return null;
    throw err;
  }
}

export async function createOrganization(name: string, externalId: string): Promise<string> {
  const workos = getWorkOSClient() as WorkOS;
  try {
    const org = await (workos as any).organizations.createOrganization({
      name,
      externalId
    });
    return org.id as string;
  } catch (err: any) {
    // Enhance error message for debugging
    const enhancedErr = new Error(
      `Failed to create organization "${name}" with external_id "${externalId}": ${err.message}`
    );
    // Preserve original error properties for retry logic
    enhancedErr.stack = err.stack;
    (enhancedErr as any).status = err.status;
    (enhancedErr as any).original = err;
    throw enhancedErr;
  }
}

export async function resolveOrganizationById(orgId: string): Promise<string | null> {
  const exists = await getOrganizationById(orgId);
  return exists ? orgId : null;
}

export async function resolveOrganization(options: {
  orgId?: string;
  orgExternalId?: string;
  createIfMissing?: boolean;
  orgName?: string;
}): Promise<string | null> {
  const { orgId, orgExternalId, createIfMissing, orgName } = options;
  if (!orgId && !orgExternalId) return null; // user-only mode
  if (orgId && orgExternalId) {
    throw new Error("Provide only one of --org-id or --org-external-id, not both.");
  }
  if (orgId) {
    const exists = await getOrganizationById(orgId);
    if (!exists) {
      throw new Error(`Organization not found for id: ${orgId}`);
    }
    return orgId;
  }
  // orgExternalId path
  const found = await getOrganizationByExternalId(orgExternalId!);
  if (found) return found;
  if (!createIfMissing) {
    throw new Error(`Organization not found for external_id: ${orgExternalId}`);
  }
  if (!orgName || String(orgName).trim() === "") {
    throw new Error("--org-name is required when using --create-org-if-missing");
  }
  const createdId = await createOrganization(orgName, orgExternalId!);
  return createdId;
}

