/**
 * Migration Wizard - Question Flow
 *
 * Interactive questions to gather migration configuration.
 */

import prompts from "prompts";
import chalk from "chalk";
import type { WizardAnswers, WizardOptions } from "./types.js";

/**
 * Ask all wizard questions and return answers
 */
export async function askQuestions(
  options: WizardOptions
): Promise<WizardAnswers> {
  // ASCII art banner with wizard
  const banner = `
╔═══════════════════════════════════════════════════════════════════════╗
║                                                                       ║
║       __/\\__          __  __ _               _   _                    ║
║  . _  \\\\''//         |  \\/  (_)__ _ _ _ __ _| |_(_)___ _ _            ║
║  -( )-/_||_\\         | |\\/| | / _\` | '_/ _\` |  _| / _ \\ ' \\           ║
║   .'. \\_()_/         |_|  |_|_\\__, |_| \\__,_|\\__|_\\___/_||_|          ║
║    |   / . \\                  |___/                                   ║
║    |==| .   \\           __      ___                _                  ║
║  . . ,\\_____'.          \\ \\    / (_)_______ _ _ __| |                 ║
║                          \\ \\/\\/ /| |_ / _\` | '_/ _\` |                 ║
║                           \\_/\\_/ |_/__\\__,_|_| \\__,_|                 ║
║                                                                       ║
║                                                                       ║
╚═════════════════════════════ By WorkOS ═══════════════════════════════╝
`;
  console.log(chalk.cyan(banner));

  const answers: Partial<WizardAnswers> = {};

  // Question 1: Migration source
  if (options.source) {
    answers.source = options.source;
    console.log(chalk.gray(`Source: ${options.source} (from CLI flag)`));
  } else {
    const sourceAnswer = await prompts({
      type: "select",
      name: "source",
      message: "What are you migrating from?",
      choices: [
        { title: "Auth0", value: "auth0" },
        { title: "Clerk", value: "clerk" },
        { title: "Firebase", value: "firebase" },
        { title: "Okta (coming soon)", value: "okta", disabled: true },
        { title: "Cognito (coming soon)", value: "cognito", disabled: true },
        { title: "Custom CSV (I already have a CSV file)", value: "custom" },
      ],
    });

    if (!sourceAnswer.source) {
      throw new Error("Migration source is required");
    }

    answers.source = sourceAnswer.source;
  }

  // If custom CSV, ask for path
  if (answers.source === "custom") {
    const csvAnswer = await prompts({
      type: "text",
      name: "customCsvPath",
      message: "Path to your CSV file:",
      validate: (value: string) =>
        value.trim().length > 0 || "CSV path is required",
    });

    if (!csvAnswer.customCsvPath) {
      throw new Error("CSV path is required");
    }

    answers.customCsvPath = csvAnswer.customCsvPath;
  }

  // If Auth0, ask for credentials
  if (answers.source === "auth0") {
    await askAuth0Credentials(answers, options);
  }

  // If Clerk, ask for file paths
  if (answers.source === "clerk") {
    await askClerkConfiguration(answers);
  }

  // If Firebase, ask for file paths and hash params
  if (answers.source === "firebase") {
    await askFirebaseConfiguration(answers);
  }

  // Question 2: Import mode
  // Auto-set to multi-org for Clerk/Firebase with org mapping
  if ((answers.source === "clerk" && answers.clerkOrgMappingPath) ||
      (answers.source === "firebase" && answers.firebaseOrgMappingPath)) {
    answers.importMode = "multi-org";
    console.log(
      chalk.gray("Import mode: multi-org (auto-set from org mapping file)\n")
    );
  } else {
    const modeAnswer = await prompts({
      type: "select",
      name: "importMode",
      message: "How do you want to import users?",
      choices: [
        {
          title: "Single organization (all users go to one org)",
          value: "single-org",
          description: "All users will be added to the same WorkOS organization",
        },
        {
          title: "Multiple organizations (CSV has org columns)",
          value: "multi-org",
          description:
            "CSV contains org_id, org_external_id, or org_name columns",
        },
      ],
    });

    if (!modeAnswer.importMode) {
      throw new Error("Import mode is required");
    }

    answers.importMode = modeAnswer.importMode;
  }

  // If single-org, ask for org specification
  if (answers.importMode === "single-org") {
    await askOrgSpecification(answers, options);
  }

  // Role configuration (universal — all sources)
  await askRoleConfiguration(answers);

  // Question 3: Scale and performance
  await askScaleAndPerformance(answers);

  // Question 4: Validation
  await askValidation(answers);

  // Question 5: Error handling
  await askErrorHandling(answers);

  // Question 6: Dry run
  await askDryRun(answers);

  return answers as WizardAnswers;
}

/**
 * Ask Auth0 credentials
 */
async function askAuth0Credentials(
  answers: Partial<WizardAnswers>,
  options: WizardOptions
): Promise<void> {
  console.log(chalk.cyan("\n📋 Auth0 Configuration"));
  console.log(
    chalk.gray(
      "We need your Auth0 M2M application credentials to export users.\n"
    )
  );

  // Show setup instructions
  const needsSetup = await prompts({
    type: "confirm",
    name: "needsSetup",
    message: "Do you have Auth0 M2M application credentials?",
    initial: false,
  });

  if (!needsSetup.needsSetup) {
    console.log(
      chalk.yellow("\nLet me guide you through setting up Auth0 credentials:\n")
    );
    console.log("1. Go to your Auth0 Dashboard → Applications → Applications");
    console.log('2. Click "Create Application" → "Machine to Machine"');
    console.log('3. Name it "WorkOS Migration Tool"');
    console.log("4. Select the Auth0 Management API");
    console.log("5. Grant these permissions:");
    console.log("   ✓ read:users");
    console.log("   ✓ read:organizations");
    console.log("   ✓ read:organization_members");
    console.log("6. Copy the Domain, Client ID, and Client Secret\n");

    const ready = await prompts({
      type: "confirm",
      name: "ready",
      message: "Ready to enter credentials?",
      initial: true,
    });

    if (!ready.ready) {
      throw new Error("Auth0 credentials are required");
    }
  }

  // Ask for credentials
  if (options.auth0Domain) {
    answers.auth0Domain = options.auth0Domain;
    console.log(
      chalk.gray(`Auth0 Domain: ${options.auth0Domain} (from CLI flag)`)
    );
  } else {
    const domainAnswer = await prompts({
      type: "text",
      name: "auth0Domain",
      message: "Auth0 Domain (e.g., dev-example.us.auth0.com):",
      validate: (value: string) => {
        if (!value.trim()) return "Domain is required";
        if (!value.includes(".auth0.com"))
          return "Domain should end with .auth0.com";
        return true;
      },
    });

    if (!domainAnswer.auth0Domain) {
      throw new Error("Auth0 domain is required");
    }

    answers.auth0Domain = domainAnswer.auth0Domain;
  }

  const credentialsAnswer = await prompts([
    {
      type: "password",
      name: "auth0ClientId",
      message: "Client ID:",
      validate: (value: string) =>
        value.trim().length > 0 || "Client ID is required",
    },
    {
      type: "password",
      name: "auth0ClientSecret",
      message: "Client Secret:",
      validate: (value: string) =>
        value.trim().length > 0 || "Client Secret is required",
    },
  ]);

  if (
    !credentialsAnswer.auth0ClientId ||
    !credentialsAnswer.auth0ClientSecret
  ) {
    throw new Error("Auth0 credentials are required");
  }

  answers.auth0ClientId = credentialsAnswer.auth0ClientId;
  answers.auth0ClientSecret = credentialsAnswer.auth0ClientSecret;

  console.log(chalk.green("✓ Auth0 credentials configured\n"));

  // Ask about organization export
  console.log(chalk.cyan("🏢 Organization Export"));
  console.log(
    chalk.gray("Organizations can be exported from Auth0 using different methods.\n")
  );

  const includeOrgsAnswer = await prompts({
    type: "confirm",
    name: "includeOrgs",
    message: "Should this export include Organizations?",
    initial: true,
  });

  answers.auth0IncludeOrgs = includeOrgsAnswer.includeOrgs ?? true;

  if (answers.auth0IncludeOrgs) {
    const orgMethodAnswer = await prompts({
      type: "select",
      name: "orgMethod",
      message: "How should organizations be discovered?",
      choices: [
        {
          title: "Organizations API",
          value: "api",
          description: "Uses Auth0 Organizations API (requires Enterprise or Trial plan)",
        },
        {
          title: "User metadata",
          value: "metadata",
          description: "Derives organizations from user_metadata fields",
        },
      ],
      initial: 1, // Default to metadata as it's more common
    });

    answers.auth0OrgMethod = orgMethodAnswer.orgMethod || "metadata";

    // Set deprecated flag for backward compatibility
    answers.auth0UseMetadata = answers.auth0OrgMethod === "metadata";

    console.log(
      chalk.green(
        `✓ Organizations: ${answers.auth0OrgMethod === 'api' ? 'Organizations API' : 'User metadata'}\n`
      )
    );
  } else {
    console.log(chalk.gray("Organizations will not be exported\n"));
  }

  // Ask about rate limiting
  console.log(chalk.cyan("⚡ Rate Limiting"));
  console.log(
    chalk.gray("Auth0 has different rate limits based on your plan tier.")
  );
  console.log(
    chalk.gray("Choose the rate limit that matches your Auth0 plan.\n")
  );

  const rateLimitAnswer = await prompts({
    type: "select",
    name: "rateLimit",
    message: "What is your Auth0 API rate limit?",
    choices: [
      {
        title: "2 RPS (Free tier)",
        value: 2,
        description: "Free tier or Trial plan",
      },
      {
        title: "4 RPS (Custom tier)",
        value: 4,
        description: "Custom configuration",
      },
      {
        title: "50 RPS (Developer tier)",
        value: 50,
        description: "Standard Developer plan",
      },
      {
        title: "100 RPS (Enterprise tier)",
        value: 100,
        description: "Enterprise plan",
      },
    ],
    initial: 2, // Default to 50 RPS (Developer tier)
  });

  answers.auth0RateLimit = rateLimitAnswer.rateLimit || 50;

  console.log(
    chalk.green(
      `✓ Rate limit: ${answers.auth0RateLimit} requests per second\n`
    )
  );

  // Ask about password hashes
  console.log(chalk.cyan("🔐 Password Hashes"));
  console.log(
    chalk.gray("Auth0 does not provide password hashes via the Management API.")
  );
  console.log(
    chalk.gray("You must request a password export from Auth0 support.")
  );
  console.log(
    chalk.gray(
      "This provides an NDJSON file with user emails and bcrypt hashes.\n"
    )
  );

  const passwordAnswer = await prompts({
    type: "confirm",
    name: "hasPasswords",
    message: "Do you have an Auth0 password export file (NDJSON)?",
    initial: false,
  });

  answers.auth0HasPasswords = passwordAnswer.hasPasswords;

  if (passwordAnswer.hasPasswords) {
    const pathAnswer = await prompts({
      type: "text",
      name: "passwordsPath",
      message: "Path to Auth0 password NDJSON file:",
      validate: (value: string) => {
        if (!value.trim()) return "Password file path is required";
        // Basic validation - file should end in .json or .ndjson
        if (!value.match(/\.(ndjson|json|jsonl)$/i)) {
          return "File should be NDJSON format (.ndjson, .json, or .jsonl)";
        }
        return true;
      },
    });

    if (!pathAnswer.passwordsPath) {
      throw new Error("Password file path is required");
    }

    answers.auth0PasswordsPath = pathAnswer.passwordsPath;
    console.log(chalk.green("✓ Password file configured\n"));
  } else {
    console.log(
      chalk.yellow("⚠️  Users will be imported without password hashes\n")
    );
    console.log(
      chalk.gray("Users will need to reset their passwords on first login.\n")
    );
  }
}

/**
 * Ask Clerk configuration (file paths)
 */
async function askClerkConfiguration(
  answers: Partial<WizardAnswers>
): Promise<void> {
  console.log(chalk.cyan("\n📋 Clerk Configuration"));
  console.log(
    chalk.gray(
      "We'll transform your Clerk user export into WorkOS format.\n" +
      "The standard Clerk CSV export includes: id, first_name, last_name, username,\n" +
      "primary_email_address, phone numbers, password_digest, password_hasher, etc.\n"
    )
  );

  // Prompt for Clerk CSV export path
  const csvAnswer = await prompts({
    type: "text",
    name: "clerkCsvPath",
    message: "Path to your Clerk CSV export file:",
    validate: (value: string) => {
      if (!value.trim()) return "Clerk CSV path is required";
      if (!value.endsWith(".csv")) return "File should be a .csv file";
      return true;
    },
  });

  if (!csvAnswer.clerkCsvPath) {
    throw new Error("Clerk CSV path is required");
  }

  answers.clerkCsvPath = csvAnswer.clerkCsvPath;
  console.log(chalk.green("✓ Clerk CSV configured\n"));

  // Ask about org mapping file
  const orgMappingAnswer = await prompts({
    type: "confirm",
    name: "hasOrgMapping",
    message: "Do you have a user-to-organization mapping CSV?",
    initial: false,
  });

  if (orgMappingAnswer.hasOrgMapping) {
    const mappingPathAnswer = await prompts({
      type: "text",
      name: "clerkOrgMappingPath",
      message: "Path to organization mapping CSV:",
      validate: (value: string) => {
        if (!value.trim()) return "Org mapping CSV path is required";
        if (!value.endsWith(".csv")) return "File should be a .csv file";
        return true;
      },
    });

    if (!mappingPathAnswer.clerkOrgMappingPath) {
      throw new Error("Org mapping CSV path is required");
    }

    answers.clerkOrgMappingPath = mappingPathAnswer.clerkOrgMappingPath;

    console.log(
      chalk.cyan("\n🏢 Organization Mapping")
    );
    console.log(
      chalk.gray(
        "Organizations will be created in WorkOS if they don't already exist.\n" +
        "Your org mapping CSV should have a 'clerk_user_id' column plus one or more of:\n" +
        "  org_id, org_external_id, org_name\n" +
        "Including 'org_name' alongside 'org_external_id' allows new organizations\n" +
        "to be auto-created during import.\n"
      )
    );
    console.log(chalk.green("✓ Organization mapping configured\n"));
  } else {
    console.log(
      chalk.gray(
        "\nUsers will be imported without organization memberships.\n" +
        "You can add org memberships later.\n"
      )
    );
  }

  // Display transform info
  console.log(
    chalk.gray(
      "The Clerk transform step will:\n" +
      "  • Map Clerk fields to WorkOS format (email, name, external_id)\n" +
      "  • Migrate bcrypt password hashes for seamless authentication\n" +
      "  • Store extra Clerk fields (username, phones, TOTP) in metadata\n" +
      "\nNote: If you provide a user-role mapping CSV later,\n" +
      "it should use 'clerk_user_id' as the join key (same as org mapping).\n"
    )
  );

  console.log(chalk.green("✓ Clerk configuration complete\n"));
}

/**
 * Ask Firebase configuration (file paths, hash params, name splitting)
 */
async function askFirebaseConfiguration(
  answers: Partial<WizardAnswers>
): Promise<void> {
  console.log(chalk.cyan("\n📋 Firebase Configuration"));
  console.log(
    chalk.gray(
      "We'll transform your Firebase Auth JSON export into WorkOS format.\n" +
      "Export your users with: firebase auth:export users.json --format=JSON --project=<id>\n"
    )
  );

  // 1. Ask for Firebase JSON path
  const jsonAnswer = await prompts({
    type: "text",
    name: "firebaseJsonPath",
    message: "Path to your Firebase JSON export file:",
    validate: (value: string) => {
      if (!value.trim()) return "Firebase JSON path is required";
      if (!value.endsWith(".json")) return "File should be a .json file";
      return true;
    },
  });

  if (!jsonAnswer.firebaseJsonPath) {
    throw new Error("Firebase JSON path is required");
  }

  answers.firebaseJsonPath = jsonAnswer.firebaseJsonPath;
  console.log(chalk.green("✓ Firebase JSON configured\n"));

  // 2. Ask about password migration
  console.log(chalk.cyan("🔐 Password Hash Migration"));
  console.log(
    chalk.gray(
      "Firebase uses a modified scrypt algorithm for passwords.\n" +
      "To migrate passwords, you need the hash parameters from your Firebase Console:\n" +
      "  Authentication > Users > (⋮ menu) > Password Hash Parameters\n"
    )
  );

  const hasHashParams = await prompts({
    type: "confirm",
    name: "hasHashParams",
    message: "Do you have Firebase password hash parameters?",
    initial: false,
  });

  if (hasHashParams.hasHashParams) {
    const hashParams = await prompts([
      {
        type: "password",
        name: "signerKey",
        message: "Signer key (base64_signer_key):",
        validate: (value: string) =>
          value.trim().length > 0 || "Signer key is required",
      },
      {
        type: "text",
        name: "saltSeparator",
        message: "Salt separator (base64_salt_separator):",
        initial: "Bw==",
      },
      {
        type: "number",
        name: "rounds",
        message: "Rounds:",
        initial: 8,
        min: 1,
      },
      {
        type: "number",
        name: "memCost",
        message: "Memory cost (mem_cost):",
        initial: 14,
        min: 1,
      },
    ]);

    if (!hashParams.signerKey) {
      throw new Error("Signer key is required for password migration");
    }

    answers.firebaseSignerKey = hashParams.signerKey;
    answers.firebaseSaltSeparator = hashParams.saltSeparator || "Bw==";
    answers.firebaseRounds = hashParams.rounds || 8;
    answers.firebaseMemCost = hashParams.memCost || 14;

    console.log(chalk.green("✓ Password hash parameters configured\n"));
  } else {
    console.log(
      chalk.yellow("⚠️  Users will be imported without password hashes\n")
    );
    console.log(
      chalk.gray("Users will need to reset their passwords on first login.\n")
    );
  }

  // 3. Ask about name splitting
  console.log(chalk.cyan("👤 Display Name Handling"));
  console.log(
    chalk.gray(
      "Firebase stores names as a single 'displayName' field.\n" +
      "Choose how to split into first and last name for WorkOS.\n"
    )
  );

  const nameSplitAnswer = await prompts({
    type: "select",
    name: "nameSplit",
    message: "How should display names be split?",
    choices: [
      {
        title: "Split on first space (e.g., 'John Doe' → John / Doe)",
        value: "first-space",
      },
      {
        title: "Split on last space (e.g., 'Mary Jane Watson' → Mary Jane / Watson)",
        value: "last-space",
      },
      {
        title: "Keep full name as first name (no splitting)",
        value: "first-name-only",
      },
    ],
  });

  answers.firebaseNameSplit = nameSplitAnswer.nameSplit || "first-space";

  // 4. Ask about disabled users
  const disabledAnswer = await prompts({
    type: "confirm",
    name: "includeDisabled",
    message: "Include disabled users in the migration?",
    initial: false,
  });

  answers.firebaseIncludeDisabled = disabledAnswer.includeDisabled ?? false;

  // 5. Ask about org mapping
  const orgMappingAnswer = await prompts({
    type: "confirm",
    name: "hasOrgMapping",
    message: "Do you have a user-to-organization mapping CSV?",
    initial: false,
  });

  if (orgMappingAnswer.hasOrgMapping) {
    const mappingPathAnswer = await prompts({
      type: "text",
      name: "firebaseOrgMappingPath",
      message: "Path to organization mapping CSV:",
      validate: (value: string) => {
        if (!value.trim()) return "Org mapping CSV path is required";
        if (!value.endsWith(".csv")) return "File should be a .csv file";
        return true;
      },
    });

    if (!mappingPathAnswer.firebaseOrgMappingPath) {
      throw new Error("Org mapping CSV path is required");
    }

    answers.firebaseOrgMappingPath = mappingPathAnswer.firebaseOrgMappingPath;

    console.log(chalk.cyan("\n🏢 Organization Mapping"));
    console.log(
      chalk.gray(
        "Organizations will be created in WorkOS if they don't already exist.\n" +
        "Your org mapping CSV should have a 'firebase_uid' column plus one or more of:\n" +
        "  org_id, org_external_id, org_name\n" +
        "Including 'org_name' alongside 'org_external_id' allows new organizations\n" +
        "to be auto-created during import.\n"
      )
    );
    console.log(chalk.green("✓ Organization mapping configured\n"));
  } else {
    console.log(
      chalk.gray(
        "\nUsers will be imported without organization memberships.\n" +
        "You can add org memberships later.\n"
      )
    );
  }

  // Display transform info
  console.log(
    chalk.gray(
      "The Firebase transform step will:\n" +
      "  • Map Firebase fields to WorkOS format (email, name, external_id)\n" +
      "  • Migrate scrypt password hashes in PHC format (if hash params provided)\n" +
      "  • Store extra Firebase fields (phone, photo, MFA, providers) in metadata\n" +
      "\nNote: If you provide a user-role mapping CSV later,\n" +
      "it should use 'firebase_uid' as the join key (same as org mapping).\n"
    )
  );

  console.log(chalk.green("✓ Firebase configuration complete\n"));
}

/**
 * Ask role configuration (universal — applies to all sources)
 */
async function askRoleConfiguration(
  answers: Partial<WizardAnswers>
): Promise<void> {
  console.log(chalk.cyan("\n🔑 Roles & Permissions"));
  console.log(
    chalk.gray(
      "You can optionally map roles and permissions from your existing system.\n" +
      "This requires two CSVs:\n" +
      "  1. Role definitions: what roles should exist in WorkOS\n" +
      "  2. User-role mapping: which users get which roles\n"
    )
  );

  const hasRolesAnswer = await prompts({
    type: "confirm",
    name: "hasRoleMapping",
    message: "Do you have role/permission data to migrate?",
    initial: false,
  });

  if (!hasRolesAnswer.hasRoleMapping) {
    console.log(chalk.gray("\nSkipping role migration.\n"));
    return;
  }

  // Ask for role definitions CSV
  const hasDefinitionsAnswer = await prompts({
    type: "confirm",
    name: "hasRoleDefinitions",
    message:
      "Do you have a role definitions CSV? (defines roles and their permissions)",
    initial: true,
  });

  answers.hasRoleDefinitions = hasDefinitionsAnswer.hasRoleDefinitions;

  if (hasDefinitionsAnswer.hasRoleDefinitions) {
    const definitionsPathAnswer = await prompts({
      type: "text",
      name: "roleDefinitionsPath",
      message: "Path to role definitions CSV:",
      validate: (value: string) => {
        if (!value.trim()) return "Path is required";
        if (!value.endsWith(".csv")) return "File should be a .csv file";
        return true;
      },
    });
    answers.roleDefinitionsPath = definitionsPathAnswer.roleDefinitionsPath;
    console.log(chalk.green("✓ Role definitions configured\n"));
  }

  // Ask for user-role mapping CSV
  const mappingPathAnswer = await prompts({
    type: "text",
    name: "roleMappingPath",
    message: "Path to user-role mapping CSV (external_id → role_slug):",
    validate: (value: string) => {
      if (!value.trim()) return "Path is required";
      if (!value.endsWith(".csv")) return "File should be a .csv file";
      return true;
    },
  });
  answers.roleMappingPath = mappingPathAnswer.roleMappingPath;
  answers.hasRoleMapping = true;

  console.log(chalk.green("✓ Role mapping configured\n"));
}

/**
 * Ask organization specification
 */
async function askOrgSpecification(
  answers: Partial<WizardAnswers>,
  options: WizardOptions
): Promise<void> {
  console.log(chalk.cyan("\n🏢 Organization Configuration"));

  // Ask how to specify org
  const methodAnswer = await prompts({
    type: "select",
    name: "orgSpecMethod",
    message: "How do you want to specify the organization?",
    choices: [
      {
        title: "Organization ID (org_xxx)",
        value: "org-id",
        description: "WorkOS organization ID",
      },
      {
        title: "Organization external ID",
        value: "org-external-id",
        description: "Your external identifier for the organization",
      },
      {
        title: "Organization name (will create if missing)",
        value: "org-name",
        description: "Organization name - creates if doesn't exist",
      },
    ],
  });

  if (!methodAnswer.orgSpecMethod) {
    throw new Error("Organization specification method is required");
  }

  answers.orgSpecMethod = methodAnswer.orgSpecMethod;

  // Ask for the specific value
  if (options.orgId && methodAnswer.orgSpecMethod === "org-id") {
    answers.orgId = options.orgId;
    console.log(
      chalk.gray(`Organization ID: ${options.orgId} (from CLI flag)`)
    );
  } else {
    let promptConfig;
    if (methodAnswer.orgSpecMethod === "org-id") {
      promptConfig = {
        type: "text" as const,
        name: "orgId",
        message: "Enter organization ID:",
        validate: (value: string) => {
          if (!value.trim()) return "Organization ID is required";
          if (!value.startsWith("org_"))
            return "Organization ID should start with org_";
          return true;
        },
      };
    } else if (methodAnswer.orgSpecMethod === "org-external-id") {
      promptConfig = {
        type: "text" as const,
        name: "orgExternalId",
        message: "Enter organization external ID:",
        validate: (value: string) =>
          value.trim().length > 0 || "External ID is required",
      };
    } else {
      promptConfig = {
        type: "text" as const,
        name: "orgName",
        message: "Enter organization name:",
        validate: (value: string) =>
          value.trim().length > 0 || "Organization name is required",
      };
    }

    const orgValueAnswer = await prompts(promptConfig);

    if (methodAnswer.orgSpecMethod === "org-id") {
      if (!orgValueAnswer.orgId) throw new Error("Organization ID is required");
      answers.orgId = orgValueAnswer.orgId;
    } else if (methodAnswer.orgSpecMethod === "org-external-id") {
      if (!orgValueAnswer.orgExternalId)
        throw new Error("Organization external ID is required");
      answers.orgExternalId = orgValueAnswer.orgExternalId;
    } else {
      if (!orgValueAnswer.orgName)
        throw new Error("Organization name is required");
      answers.orgName = orgValueAnswer.orgName;

      // Ask if should create org if missing
      const createAnswer = await prompts({
        type: "confirm",
        name: "createOrgIfMissing",
        message: "Create organization if it doesn't exist?",
        initial: true,
      });

      answers.createOrgIfMissing = createAnswer.createOrgIfMissing;
    }
  }

  console.log();
}

/**
 * Ask scale and performance questions
 */
async function askScaleAndPerformance(
  answers: Partial<WizardAnswers>
): Promise<void> {
  console.log(chalk.cyan("⚡ Scale & Performance"));

  const scaleAnswer = await prompts({
    type: "select",
    name: "scale",
    message: "Approximately how many users are you migrating?",
    choices: [
      { title: "Less than 10,000", value: "small" },
      { title: "10,000 - 100,000", value: "medium" },
      { title: "More than 100,000", value: "large" },
    ],
  });

  if (!scaleAnswer.scale) {
    throw new Error("Scale is required");
  }

  answers.scale = scaleAnswer.scale;

  // Recommend checkpointing for medium/large
  const recommendCheckpoint = answers.scale !== "small";

  const checkpointAnswer = await prompts({
    type: "confirm",
    name: "enableCheckpointing",
    message: "Enable checkpointing for resumability?",
    initial: recommendCheckpoint,
    hint: recommendCheckpoint ? "(recommended for your scale)" : undefined,
  });

  answers.enableCheckpointing =
    checkpointAnswer.enableCheckpointing ?? recommendCheckpoint;

  // Ask about workers for medium and large migrations
  if ((answers.scale === "medium" || answers.scale === "large") && answers.enableCheckpointing) {
    const workersAnswer = await prompts([
      {
        type: "confirm",
        name: "enableWorkers",
        message: "Enable multi-worker processing for faster imports?",
        initial: answers.scale === "large", // Recommend for large, optional for medium
        hint: answers.scale === "large"
          ? "(recommended for large migrations)"
          : "(can improve performance for medium migrations)",
      },
      {
        type: (prev: boolean) => (prev ? "number" : null),
        name: "workerCount",
        message: "How many workers?",
        initial: answers.scale === "large" ? 4 : 2, // Fewer workers for medium scale
        min: 2,
        max: 8,
        validate: (value: number) =>
          (value >= 2 && value <= 8) || "Workers must be between 2 and 8",
      },
    ]);

    answers.enableWorkers = workersAnswer.enableWorkers;
    answers.workerCount = workersAnswer.workerCount;
  }

  console.log();
}

/**
 * Ask validation questions
 */
async function askValidation(answers: Partial<WizardAnswers>): Promise<void> {
  console.log(chalk.cyan("✅ Data Validation"));

  const validationAnswer = await prompts([
    {
      type: "confirm",
      name: "validateCsv",
      message: "Validate CSV before importing?",
      initial: true,
      hint: "(recommended)",
    },
    {
      type: (prev: boolean) => (prev ? "confirm" : null),
      name: "autoFixIssues",
      message: "Automatically fix common issues (whitespace, formatting)?",
      initial: true,
    },
  ]);

  answers.validateCsv = validationAnswer.validateCsv ?? true;
  answers.autoFixIssues = validationAnswer.autoFixIssues ?? true;

  console.log();
}

/**
 * Ask error handling questions
 */
async function askErrorHandling(
  answers: Partial<WizardAnswers>
): Promise<void> {
  console.log(chalk.cyan("🔧 Error Handling"));

  const errorAnswer = await prompts([
    {
      type: "confirm",
      name: "logErrors",
      message: "Log errors to file for retry?",
      initial: true,
      hint: "(recommended)",
    },
    {
      type: (prev: boolean) => (prev ? "text" : null),
      name: "errorsPath",
      message: "Error log file path:",
      initial: "errors.jsonl",
    },
  ]);

  answers.logErrors = errorAnswer.logErrors ?? true;
  answers.errorsPath = errorAnswer.errorsPath || "errors.jsonl";

  console.log();
}

/**
 * Ask about dry run
 */
async function askDryRun(answers: Partial<WizardAnswers>): Promise<void> {
  console.log(chalk.cyan("🧪 Dry Run"));
  console.log(
    chalk.gray(
      "A dry run validates your import without creating any users in WorkOS.\n" +
      "This helps verify configuration, CSV format, and organization resolution.\n"
    )
  );

  const dryRunAnswer = await prompts({
    type: "confirm",
    name: "runDryRunFirst",
    message: "Run a dry-run test before the live import?",
    initial: true,
    hint: "(recommended for first-time migrations)",
  });

  answers.runDryRunFirst = dryRunAnswer.runDryRunFirst ?? true;

  console.log();
}
