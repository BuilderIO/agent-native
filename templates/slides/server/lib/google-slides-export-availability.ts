import { getWorkspaceConnectionProvider } from "@agent-native/core/connections";

import {
  checkGoogleOAuthPreflight,
  type GoogleOAuthPreflight,
} from "./google-oauth-preflight.js";

/**
 * The "Export to Google Slides" menu item launches a top-level navigation into
 * Google's consent screen. When the Google Cloud Console side of that flow is
 * broken the user leaves the editor and lands on a Google error page, so the
 * item has to know it is unusable *before* it is presented as a working option.
 */
export type GoogleSlidesExportAvailability =
  | { available: true }
  | {
      available: false;
      /**
       * `not-configured`: no Google OAuth client credentials resolve for this
       * caller. `oauth-rejected`: credentials exist but Google refuses the
       * authorization request itself (an unregistered redirect URI, a deleted
       * client), which no user action can recover from.
       */
      reason: "not-configured" | "oauth-rejected";
      code?: string;
    };

/**
 * Scopes and callback path are read from the shared connection catalog rather
 * than restated here: the probe is only meaningful if it asks Google about the
 * exact request `startWorkspaceProviderOAuth("google_drive")` will send.
 */
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
  /**
   * A stored Drive-upload-capable account. Its unexpired access token uploads
   * without resolving client credentials at all
   * (`refreshGoogleDocsToken` returns early), so this export can succeed even
   * when no OAuth client is configured.
   */
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

  // An inconclusive probe must not disable an export that may work perfectly
  // well; it only means this run produced no verdict.
  if (result.status === "rejected") {
    return { available: false, reason: "oauth-rejected", code: result.code };
  }
  return { available: true };
}
