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
    // Some SDKs expose list with filters; fallback to catch 404 if retrieve method exists
    const resp = await (workos as any).organizations.listOrganizations({ externalId, limit: 1 });
    const org = resp?.data?.[0];
    return org?.id ?? null;
  } catch {
    return null;
  }
}

export async function createOrganization(name: string, externalId: string): Promise<string> {
  const workos = getWorkOSClient() as WorkOS;
  const org = await (workos as any).organizations.createOrganization({
    name,
    externalId
  });
  return org.id as string;
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

