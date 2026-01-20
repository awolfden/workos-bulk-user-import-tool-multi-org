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

  // Question 2: Import mode
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

  // If single-org, ask for org specification
  if (answers.importMode === "single-org") {
    await askOrgSpecification(answers, options);
  }

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

  // Ask about Auth0 plan tier for rate limiting and organization discovery
  console.log(chalk.cyan("⚡ Auth0 Plan & Rate Limiting"));
  console.log(
    chalk.gray("Auth0 has different rate limits and features based on your plan tier.")
  );
  console.log(
    chalk.gray("This determines both API rate limits and organization discovery method.\n")
  );

  const planTierAnswer = await prompts({
    type: "select",
    name: "planTier",
    message: "What Auth0 plan tier are you on?",
    choices: [
      {
        title: "Developer (50 RPS, metadata-based orgs)",
        value: "developer",
        description: "Standard plan - uses user_metadata for organization discovery",
      },
      {
        title: "Trial (2 RPS, Organizations API)",
        value: "trial",
        description: "Trial with Organizations API - uses native Auth0 organizations",
      },
      {
        title: "Free (2 RPS, metadata-based orgs)",
        value: "free",
        description: "Free tier - limited rate, uses user_metadata for orgs",
      },
      {
        title: "Enterprise (100+ RPS, Organizations API)",
        value: "enterprise",
        description: "Enterprise plan - uses native Auth0 organizations",
      },
    ],
    initial: 0, // Developer as default
  });

  const planTier = planTierAnswer.planTier || "developer";
  answers.auth0PlanTier = planTier;

  // Set rate limit based on plan
  if (planTier === "free" || planTier === "trial") {
    answers.auth0RateLimit = 2;
  } else if (planTier === "developer") {
    answers.auth0RateLimit = 50;
  } else if (planTier === "enterprise") {
    answers.auth0RateLimit = 100;
  }

  // Set organization discovery method based on plan
  // Developer and Free plans use metadata (no Organizations API)
  // Trial and Enterprise plans use Organizations API
  if (planTier === "developer" || planTier === "free") {
    answers.auth0UseMetadata = true;
  } else if (planTier === "trial" || planTier === "enterprise") {
    answers.auth0UseMetadata = false;
  }

  console.log(
    chalk.green(
      `✓ Plan: ${planTier} (${answers.auth0RateLimit} RPS, ${answers.auth0UseMetadata ? 'metadata-based' : 'Organizations API'})\n`
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
