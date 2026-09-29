import { listFileUploadProviders } from "@agent-native/core/file-upload";
import {
  CredentialStoreUnavailableError,
  hasBuilderApiCredentialCustody,
  runWithRequestContext,
} from "@agent-native/core/server";

export const REPLAY_STORAGE_SETUP_REQUIRED_REASON =
  "Session replay storage is not connected yet. Connect Builder.io (free tier available) or configure S3-compatible storage to record replays.";

function appDatabaseUrl(): string {
  const appName = process.env.APP_NAME?.toUpperCase().replace(/-/g, "_");
  if (appName) {
    const appUrl = process.env[`${appName}_DATABASE_URL`];
    if (appUrl) return appUrl;
  }
  return process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL || "";
}

function isPGliteDatabase(): boolean {
  const url = appDatabaseUrl().toLowerCase();
  return url === "" || url.startsWith("pglite:");
}

export function requiresConfiguredReplayStorage(): boolean {
  return process.env.NODE_ENV === "production" || !isPGliteDatabase();
}

export interface ReplayStorageResolveContext {
  userEmail?: string;
  orgId?: string | null;
}

export async function hasRequestReplayStorage(
  context?: ReplayStorageResolveContext,
): Promise<boolean> {
  const resolve = async () => {
    for (const provider of listFileUploadProviders()) {
      if (provider.id === "builder") continue;
      if (provider.isConfigured()) return true;
      if (provider.isConfiguredForRequest) {
        try {
          if (await provider.isConfiguredForRequest()) return true;
        } catch {
          // Treat a failed scoped lookup as not configured.
        }
      }
    }

    try {
      return await hasBuilderApiCredentialCustody();
    } catch (err) {
      if (err instanceof CredentialStoreUnavailableError) throw err;
      return false;
    }
  };

  if (context?.userEmail) {
    return runWithRequestContext(
      { userEmail: context.userEmail, orgId: context.orgId ?? undefined },
      resolve,
    );
  }
  return resolve();
}
