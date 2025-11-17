import { WorkOS } from "@workos-inc/node";

export function getWorkOSClient(): WorkOS {
  const apiKey = process.env.WORKOS_SECRET_KEY;
  if (!apiKey || apiKey.trim() === "") {
    throw new Error("WORKOS_SECRET_KEY environment variable is required.");
  }
  return new WorkOS(apiKey);
}

