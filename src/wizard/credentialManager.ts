/**
 * Migration Wizard - Credential Manager
 *
 * Manages provider credentials (saves to .env file).
 */

import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import type { WizardAnswers, EnvironmentCheck } from "./types.js";

/**
 * Save Auth0 credentials to .env file
 */
export function saveAuth0Credentials(answers: WizardAnswers): void {
  if (
    !answers.auth0Domain ||
    !answers.auth0ClientId ||
    !answers.auth0ClientSecret
  ) {
    return;
  }

  const envPath = path.join(process.cwd(), ".env");
  let envContent = "";

  // Read existing .env if it exists
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, "utf-8");
  }

  // Parse existing variables
  const envVars = new Map<string, string>();
  envContent.split("\n").forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }
    const [key, ...valueParts] = trimmed.split("=");
    if (key) {
      envVars.set(key.trim(), valueParts.join("=").trim());
    }
  });

  // Update Auth0 credentials
  envVars.set("AUTH0_DOMAIN", answers.auth0Domain);
  envVars.set("AUTH0_CLIENT_ID", answers.auth0ClientId);
  envVars.set("AUTH0_CLIENT_SECRET", answers.auth0ClientSecret);

  // Write back to .env
  const newContent = Array.from(envVars.entries())
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  fs.writeFileSync(envPath, newContent + "\n", "utf-8");

  console.log(chalk.green("✓ Credentials saved to .env file\n"));
}

/**
 * Check environment prerequisites
 */
export function checkEnvironment(): EnvironmentCheck {
  const checks: EnvironmentCheck["checks"] = [];

  // Check for WORKOS_SECRET_KEY
  const hasWorkosKey = !!process.env.WORKOS_SECRET_KEY;
  checks.push({
    name: "WorkOS API Key",
    passed: hasWorkosKey,
    message: hasWorkosKey
      ? "Found in environment"
      : "WORKOS_SECRET_KEY environment variable not set",
  });

  // Check for Node.js version
  const nodeVersion = process.version;
  const majorVersion = parseInt(nodeVersion.slice(1).split(".")[0] || "0");
  const hasValidNode = majorVersion >= 18;
  checks.push({
    name: "Node.js Version",
    passed: hasValidNode,
    message: hasValidNode
      ? `${nodeVersion} (OK)`
      : `${nodeVersion} (requires Node.js 18+)`,
  });

  // Check for npx
  const hasNpx = true; // If we're running, npx is available
  checks.push({
    name: "npx Command",
    passed: hasNpx,
    message: "Available",
  });

  const allPassed = checks.every((check) => check.passed);

  return {
    passed: allPassed,
    checks,
  };
}

/**
 * Display environment check results
 */
export function displayEnvironmentCheck(check: EnvironmentCheck): void {
  console.log(chalk.cyan("\n🔍 Environment Check\n"));

  check.checks.forEach((c) => {
    const icon = c.passed ? chalk.green("✓") : chalk.red("✗");
    const status = c.passed ? chalk.green("OK") : chalk.red("MISSING");
    console.log(`${icon} ${c.name}: ${status}`);
    if (c.message) {
      console.log(chalk.gray(`   ${c.message}`));
    }
  });

  if (!check.passed) {
    console.log(chalk.red("\n✗ Environment check failed\n"));
    console.log("Please fix the issues above before proceeding.\n");

    // Show fix instructions
    check.checks
      .filter((c) => !c.passed)
      .forEach((c) => {
        if (c.name === "WorkOS API Key") {
          console.log(chalk.yellow("To set WorkOS API Key:"));
          console.log("  export WORKOS_SECRET_KEY=sk_...");
          console.log("  Or add to .env file: WORKOS_SECRET_KEY=sk_...\n");
        }
        if (c.name === "Node.js Version") {
          console.log(chalk.yellow("To upgrade Node.js:"));
          console.log(
            "  Visit https://nodejs.org/ and install version 18 or higher\n"
          );
        }
      });
  } else {
    console.log(chalk.green("\n✓ All prerequisites met\n"));
  }
}

/**
 * Get Auth0 credentials from environment or answers
 */
export function getAuth0Credentials(answers: WizardAnswers): {
  domain: string;
  clientId: string;
  clientSecret: string;
} | null {
  // First check answers
  if (
    answers.auth0Domain &&
    answers.auth0ClientId &&
    answers.auth0ClientSecret
  ) {
    return {
      domain: answers.auth0Domain,
      clientId: answers.auth0ClientId,
      clientSecret: answers.auth0ClientSecret,
    };
  }

  // Then check environment
  if (
    process.env.AUTH0_DOMAIN &&
    process.env.AUTH0_CLIENT_ID &&
    process.env.AUTH0_CLIENT_SECRET
  ) {
    return {
      domain: process.env.AUTH0_DOMAIN,
      clientId: process.env.AUTH0_CLIENT_ID,
      clientSecret: process.env.AUTH0_CLIENT_SECRET,
    };
  }

  return null;
}
