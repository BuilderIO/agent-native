import { listFileUploadProviders } from "@agent-native/core/file-upload";
import {
  BUILDER_ASSETS_WRITE_SCOPE,
  canAuthorizeBuilderApiRequest,
  runWithRequestContext,
} from "@agent-native/core/server";

export const STORAGE_SETUP_REQUIRED_REASON =
  "Video storage is not connected yet. Use Builder.io (free tier available) or configure S3-compatible storage to upload clips.";

export class VideoStorageStatusUnavailableError extends Error {
  readonly causes: unknown[];

  constructor(causes: unknown[]) {
    super("Video storage status could not be checked");
    this.name = "VideoStorageStatusUnavailableError";
    this.causes = causes;
  }
}

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
  return url === "" || url.startsWith("pglite:");
}

export function requiresConfiguredVideoStorage(): boolean {
  return process.env.NODE_ENV === "production" || !isLikelyLocalDatabase();
}

export function allowsSqlRecordingChunkScratch(): boolean {
  return !requiresConfiguredVideoStorage();
}

interface VideoStorageResolveContext {
  userEmail?: string;
  orgId?: string | null;
}

export async function hasRequestVideoStorage(
  context?: VideoStorageResolveContext,
): Promise<boolean> {
  const resolve = async () => {
    const failures: unknown[] = [];
    for (const provider of listFileUploadProviders()) {
      if (provider.id === "builder") continue;
      try {
        if (provider.isConfigured()) return true;
      } catch (error) {
        failures.push(error);
      }
      if (provider.isConfiguredForRequest) {
        try {
          if (await provider.isConfiguredForRequest()) return true;
        } catch (error) {
          failures.push(error);
        }
      }
    }

    try {
      if (await canAuthorizeBuilderApiRequest(BUILDER_ASSETS_WRITE_SCOPE)) {
        return true;
      }
    } catch (error) {
      failures.push(error);
    }

    if (failures.length > 0) {
      throw new VideoStorageStatusUnavailableError(failures);
    }
    return false;
  };

  if (context?.userEmail) {
    return runWithRequestContext(
      { userEmail: context.userEmail, orgId: context.orgId ?? undefined },
      resolve,
    );
  }
  return resolve();
}

export async function shouldRejectVideoUploadWithoutStorage(): Promise<boolean> {
  if (!requiresConfiguredVideoStorage()) return false;
  return !(await hasRequestVideoStorage());
}
