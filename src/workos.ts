import { WorkOS } from "@workos-inc/node";

let _cachedClient: WorkOS | null = null;

export function getWorkOSClient(): WorkOS {
  if (_cachedClient) {
    return _cachedClient;
  }

  const apiKey = process.env.WORKOS_SECRET_KEY;
  if (!apiKey || apiKey.trim() === "") {
    throw new Error("WORKOS_SECRET_KEY environment variable is required.");
  }

  _cachedClient = new WorkOS(apiKey);
  return _cachedClient;
}

