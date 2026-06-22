import { listFileUploadProviders } from "@agent-native/core/file-upload";
import { resolveHasBuilderPrivateKey } from "@agent-native/core/server";

export const STORAGE_SETUP_REQUIRED_REASON =
  "Video storage is not connected yet. Connect Builder.io or configure S3-compatible storage to upload clips.";

function appDatabaseUrl(): string {
  const appName = process.env.APP_NAME?.toUpperCase().replace(/-/g, "_");
  if (appName) {
    const appUrl = process.env[`${appName}_DATABASE_URL`];
    if (appUrl) return appUrl;
  }
  return process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL || "";
}

function isLikelyLocalDatabase(): boolean {
  const url = appDatabaseUrl();
  return url === "" || url.startsWith("file:") || !url.includes("://");
}

export function requiresConfiguredVideoStorage(): boolean {
  return process.env.NODE_ENV === "production" || !isLikelyLocalDatabase();
}

export async function hasRequestVideoStorage(): Promise<boolean> {
  for (const provider of listFileUploadProviders()) {
    if (provider.id !== "builder" && provider.isConfigured()) return true;
  }

  try {
    return await resolveHasBuilderPrivateKey();
  } catch {
    return false;
  }
}

export async function shouldRejectVideoUploadWithoutStorage(): Promise<boolean> {
  if (!requiresConfiguredVideoStorage()) return false;
  return !(await hasRequestVideoStorage());
}
