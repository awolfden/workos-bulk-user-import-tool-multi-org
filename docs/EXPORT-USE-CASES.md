# Auth0 Export Use Cases

Common configuration patterns for different Auth0 export scenarios.

## Use Case 1: Standard Enterprise Export

**Scenario**: You have Auth0 Enterprise with Organizations API access

**When to use**:
- Organizations are set up in Auth0
- Users are added as organization members
- You have `read:organizations` and `read:organization_members` scopes

**Configuration**:
```bash
npx tsx bin/export-auth0.ts \
  --domain tenant.auth0.com \
  --client-id YOUR_CLIENT_ID \
  --client-secret YOUR_CLIENT_SECRET \
  --output export.csv
```

**Parameters**:
- `useMetadata`: `false` (default - uses Organizations API)
- `pageSize`: `100` (default - maximum allowed)

---

## Use Case 2: Metadata-Based Export

**Scenario**: You don't have Auth0 Enterprise or Organizations API unavailable

**When to use**:
- You have a non-Enterprise Auth0 plan
- Organizations feature is not enabled
- Organization info is stored in user_metadata or app_metadata

**Configuration**:
```bash
npx tsx bin/export-auth0.ts \
  --domain tenant.auth0.com \
  --client-id YOUR_CLIENT_ID \
  --client-secret YOUR_CLIENT_SECRET \
  --output export.csv \
  --use-metadata
```

**Parameters**:
- `useMetadata`: `true`
- Looks for: `organization_id`, `org_id`, `organizationId` (in user_metadata or app_metadata)
- Looks for: `organization_name`, `org_name`, `organizationName`

---

## Use Case 3: Custom Metadata Field Names

**Scenario**: Your Auth0 setup uses custom field names (e.g., `company_id`, `tenant_name`)

**When to use**:
- Metadata mode is required (non-Enterprise)
- Your metadata uses non-standard field names

**Configuration**:
```bash
npx tsx bin/export-auth0.ts \
  --domain tenant.auth0.com \
  --client-id YOUR_CLIENT_ID \
  --client-secret YOUR_CLIENT_SECRET \
  --output export.csv \
  --use-metadata \
  --metadata-org-id-field company_id \
  --metadata-org-name-field company_name
```

**User metadata structure**:
```json
{
  "user_metadata": {
    "company_id": "comp_123",
    "company_name": "Acme Inc",
    "department": "Engineering"
  }
}
```

**Parameters**:
- `useMetadata`: `true`
- `metadataOrgIdField`: Custom field name for org ID
- `metadataOrgNameField`: Custom field name for org name

---

## Use Case 4: Filtered Export (Specific Organizations)

**Scenario**: Export only specific organizations instead of entire tenant

**When to use**:
- Testing migration with a subset of organizations
- Migrating organizations in batches
- Only specific organizations are moving to WorkOS

**Configuration**:
```bash
npx tsx bin/export-auth0.ts \
  --domain tenant.auth0.com \
  --client-id YOUR_CLIENT_ID \
  --client-secret YOUR_CLIENT_SECRET \
  --output export.csv \
  --orgs org_123 org_456 org_789
```

**Parameters**:
- `organizationFilter`: Array of org IDs to include
- Organizations API mode: Uses Auth0 organization IDs
- Metadata mode: Uses metadata organization IDs

---

## Use Case 5: Export with Password Hashes

**Scenario**: Migrate users with their existing passwords (no password reset required)

**When to use**:
- You have special Auth0 permission for password export
- You want seamless user migration (users keep existing passwords)

**Prerequisites**:
- Auth0 M2M app must have `read:user_idp_tokens` scope
- Contact Auth0 support to enable this feature

**Configuration**:
```bash
npx tsx bin/export-auth0.ts \
  --domain tenant.auth0.com \
  --client-id YOUR_CLIENT_ID \
  --client-secret YOUR_CLIENT_SECRET \
  --output export.csv \
  --include-password-hashes
```

**Note**: If permission is denied, export continues without password hashes (users will need password reset).

**Parameters**:
- `includePasswordHashes`: `true`

---

## Use Case 6: Large Tenant Export (Quiet Mode)

**Scenario**: Exporting large tenant (50K+ users) without verbose output

**When to use**:
- Automated/scripted exports
- Large datasets where progress output is not needed
- CI/CD pipelines

**Configuration**:
```bash
npx tsx bin/export-auth0.ts \
  --domain tenant.auth0.com \
  --client-id YOUR_CLIENT_ID \
  --client-secret YOUR_CLIENT_SECRET \
  --output export.csv \
  --quiet
```

**Parameters**:
- `quiet`: `true`
- Only shows start/end summary, no progress updates

---

## Use Case 7: Reduced API Load

**Scenario**: Export with lower API call frequency to avoid rate limits

**When to use**:
- Shared Auth0 tenant with other services using API
- Approaching Auth0 rate limits
- Want to be conservative with API usage

**Configuration**:
```bash
npx tsx bin/export-auth0.ts \
  --domain tenant.auth0.com \
  --client-id YOUR_CLIENT_ID \
  --client-secret YOUR_CLIENT_SECRET \
  --output export.csv \
  --page-size 50
```

**Parameters**:
- `pageSize`: `50` (default is 100)
- Fewer items per request = more requests but lower burst load

---

## Parameter Decision Tree

When the LLM asks the user questions, use this decision tree:

### Question 1: "Do you have Auth0 Enterprise with Organizations feature?"
- **Yes** → Use Organizations API mode (useMetadata=false)
- **No** → Use Metadata mode (useMetadata=true)

### Question 2 (if Metadata mode): "What field names do you use for organization info?"
- **Standard** (`organization_id`, `organization_name`) → No custom fields needed
- **Custom** → Ask for `metadataOrgIdField` and `metadataOrgNameField`

### Question 3: "Do you want to export all organizations or filter to specific ones?"
- **All organizations** → No filter
- **Specific organizations** → Ask for `organizationFilter` array

### Question 4: "Do you want to export password hashes?"
- **Yes** → Set `includePasswordHashes=true` (warn about permission requirement)
- **No** → Default (passwords not exported, users will need reset)

### Question 5: "Do you want progress output during export?"
- **Yes** → Default (quiet=false)
- **No** → Set `quiet=true`

### Question 6 (Advanced): "What page size do you want to use?"
- **Default** → 100 (recommended)
- **Custom** → Ask for number between 1-100

---

## Example Conversation Flow (for MCP)

```
LLM: I can help you export users from Auth0 to WorkOS. Let me ask you a few questions:

LLM: 1. Do you have Auth0 Enterprise with the Organizations feature enabled?
User: No, I have a non-Enterprise plan.

LLM: Got it, I'll use metadata mode.

LLM: 2. What field names do you use in user_metadata for organization info?
    - Standard (organization_id, organization_name)
    - Custom field names
User: We use company_id and company_name

LLM: Perfect.

LLM: 3. Do you want to export all organizations or filter to specific ones?
User: Just export all of them.

LLM: 4. Would you like to export password hashes? (Note: Requires special Auth0 permission)
User: No, users can reset their passwords.

LLM: Great! I'll export all users using metadata mode with custom field names (company_id, company_name).

[Executes export with: useMetadata=true, metadataOrgIdField=company_id, metadataOrgNameField=company_name]
```
