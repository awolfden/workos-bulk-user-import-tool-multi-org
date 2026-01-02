import { getWorkOSClient } from "./workos.js";
export async function getOrganizationById(orgId) {
    const workos = getWorkOSClient();
    try {
        const org = await workos.organizations.getOrganization(orgId);
        return Boolean(org?.id);
    }
    catch (err) {
        const status = err?.status ?? err?.httpStatus ?? err?.response?.status ?? err?.code;
        if (status === 404)
            return false;
        throw err;
    }
}
export async function getOrganizationByExternalId(externalId) {
    const workos = getWorkOSClient();
    try {
        // Some SDKs expose list with filters; fallback to catch 404 if retrieve method exists
        const resp = await workos.organizations.listOrganizations({ externalId, limit: 1 });
        const org = resp?.data?.[0];
        return org?.id ?? null;
    }
    catch {
        return null;
    }
}
export async function createOrganization(name, externalId) {
    const workos = getWorkOSClient();
    const org = await workos.organizations.createOrganization({
        name,
        externalId
    });
    return org.id;
}
export async function resolveOrganizationById(orgId) {
    const exists = await getOrganizationById(orgId);
    return exists ? orgId : null;
}
export async function resolveOrganization(options) {
    const { orgId, orgExternalId, createIfMissing, orgName } = options;
    if (!orgId && !orgExternalId)
        return null; // user-only mode
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
    const found = await getOrganizationByExternalId(orgExternalId);
    if (found)
        return found;
    if (!createIfMissing) {
        throw new Error(`Organization not found for external_id: ${orgExternalId}`);
    }
    if (!orgName || String(orgName).trim() === "") {
        throw new Error("--org-name is required when using --create-org-if-missing");
    }
    const createdId = await createOrganization(orgName, orgExternalId);
    return createdId;
}
