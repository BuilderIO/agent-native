import { getWorkspaceConnectionProvider } from "@agent-native/core/connections";

import {
  checkGoogleOAuthPreflight,
  type GoogleOAuthPreflight,
} from "./google-oauth-preflight.js";

export type GoogleSlidesExportAvailability =
  | { available: true }
  | {
      available: false;
      reason: "not-configured" | "oauth-rejected";
      code?: string;
    };

const GOOGLE_DRIVE_CALLBACK_PATH = "/_agent-native/google/callback";

function googleDriveScopes(): readonly string[] {
  return getWorkspaceConnectionProvider("google_drive")?.oauth?.scopes ?? [];
}

export function googleDriveRedirectUri(origin: string): string {
  return `${origin}${GOOGLE_DRIVE_CALLBACK_PATH}`;
}

export async function resolveGoogleSlidesExportAvailability(input: {
  configured: boolean;
  clientId: string | null;
  origin: string;
  hasUploadCapableAccount?: boolean;
  preflight?: (args: {
    clientId: string;
    redirectUri: string;
    scopes: readonly string[];
  }) => Promise<GoogleOAuthPreflight>;
}): Promise<GoogleSlidesExportAvailability> {
  // This gate exists to stop a doomed authorization request. An already
  // connected account never starts one, so there is nothing here to prevent -
  // and disabling it would block an export that works.
  if (input.hasUploadCapableAccount) return { available: true };
  if (!input.configured || !input.clientId) {
    return { available: false, reason: "not-configured" };
  }

  const result = await (input.preflight ?? checkGoogleOAuthPreflight)({
    clientId: input.clientId,
    redirectUri: googleDriveRedirectUri(input.origin),
    scopes: googleDriveScopes(),
  });

  if (result.status === "rejected") {
    return { available: false, reason: "oauth-rejected", code: result.code };
  }
  return { available: true };
}
