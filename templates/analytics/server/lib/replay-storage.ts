import { listFileUploadProviders } from "@agent-native/core/file-upload";
import {
  resolveHasBuilderPrivateKey,
  runWithRequestContext,
} from "@agent-native/core/server";

/**
 * Session replay chunk bytes are stored through the framework file-upload /
 * private-blob path (Builder.io CDN by default, or an S3-compatible bucket).
 * In production we require a configured provider — storing replay chunks inline
 * in SQL is a local/dev-only fallback. This mirrors the Clips video-storage
 * contract so replay capture fails loudly (and the UI can prompt setup) instead
 * of silently recording empty, unplayable sessions.
 */
export const REPLAY_STORAGE_SETUP_REQUIRED_REASON =
  "Session replay storage is not connected yet. Connect Builder.io or configure S3-compatible storage to record replays.";

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

export function requiresConfiguredReplayStorage(): boolean {
  return process.env.NODE_ENV === "production" || !isLikelyLocalDatabase();
}

export interface ReplayStorageResolveContext {
  userEmail?: string;
  orgId?: string | null;
}

/**
 * Whether a durable upload provider (non-inline) is configured for the given
 * owner/org scope. Iterates registered providers (e.g. S3) first, then falls
 * back to a resolvable Builder.io private key. When a scope is supplied the
 * check runs inside that user/org request context so org-scoped `app_secrets`
 * credentials resolve — exactly the scope the anonymous replay-ingest path
 * lacks on its own.
 */
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
      return await resolveHasBuilderPrivateKey();
    } catch {
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
