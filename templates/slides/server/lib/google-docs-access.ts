import { getCredentialContext } from "@agent-native/core/server";
import { resolveWorkspaceConnectionForApp } from "@agent-native/core/workspace-connections";

import {
  getGoogleDocsAccessToken,
  type GoogleDocsAccessTokenOptions,
} from "./google-docs-oauth.js";
import { getSlidesProviderApiRuntime } from "./provider-api.js";

export interface GoogleDocsAccessToken {
  accessToken: string;
  accountEmail: string;
}

export async function resolveManagedGoogleDriveAccount(): Promise<{
  email: string;
  accessToken: string;
  scope: string;
  shared: true;
} | null> {
  if (!getCredentialContext()) return null;
  const connection = await resolveWorkspaceConnectionForApp({
    appId: "slides",
    provider: "google_drive",
    requireConnected: true,
  });
  if (!connection.available) return null;
  const credential =
    await getSlidesProviderApiRuntime().resolveOAuthAccessToken({
      provider: "google_drive",
    });
  if (!credential.accountId) return null;
  return {
    email: credential.accountId,
    accessToken: credential.accessToken,
    scope: "https://www.googleapis.com/auth/drive.readonly",
    shared: true,
  };
}

export async function getAvailableGoogleDocsAccessToken(
  owner: string,
  options: GoogleDocsAccessTokenOptions = {},
): Promise<GoogleDocsAccessToken | null> {
  const local = await getGoogleDocsAccessToken(owner, options);
  if (local) return local;
  const managed = await resolveManagedGoogleDriveAccount();
  return managed
    ? { accessToken: managed.accessToken, accountEmail: managed.email }
    : null;
}
