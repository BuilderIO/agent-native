import { TEMPLATE_APPS } from "@agent-native/shared-app-config";

import { callAppAction, callAppActionGet } from "./agent-chat/api";

const dispatchApp = TEMPLATE_APPS.find((app) => app.id === "dispatch");
export const MOBILE_DISPATCH_BASE_URL =
  dispatchApp?.url ?? "https://dispatch.agent-native.com";

export const DISPATCH_WORKSPACE_SSO_FLAG_KEY = "dispatch.workspace-sso";

export interface WorkspaceAppEmbedSession {
  startUrl: string;
  targetPath?: string;
  expiresAt?: number;
  app: string;
}

/**
 * Read the per-user rollout gate before asking Dispatch to mint a target
 * session. A disabled rollout keeps the legacy mobile session bridge intact.
 */
export async function isWorkspaceSsoEnabled(
  baseUrl = MOBILE_DISPATCH_BASE_URL,
): Promise<boolean> {
  const flags = await callAppActionGet<Record<string, unknown>>(
    "get-feature-flags",
    {},
    baseUrl,
  );
  return flags[DISPATCH_WORKSPACE_SSO_FLAG_KEY] === true;
}

/**
 * Exchange the signed-in mobile parent session for a one-time target-app
 * session. The bearer never crosses into the child WebView; only the short-
 * lived, app-scoped start URL is loaded there.
 */
export async function createWorkspaceAppEmbedSession({
  app,
  path,
  baseUrl = MOBILE_DISPATCH_BASE_URL,
}: {
  app: string;
  path?: string;
  baseUrl?: string;
}): Promise<WorkspaceAppEmbedSession> {
  const result = await callAppAction<WorkspaceAppEmbedSession>(
    "create-workspace-app-embed-session",
    {
      app,
      ...(path ? { path } : {}),
      chrome: "minimal",
    },
    baseUrl,
  );
  if (!result || typeof result.startUrl !== "string" || !result.startUrl) {
    throw new Error("Dispatch did not return a workspace app session.");
  }
  try {
    const parsed = new URL(result.startUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("Dispatch returned an invalid workspace app session.");
    }
  } catch (error) {
    throw error instanceof Error
      ? error
      : new Error("Dispatch returned an invalid workspace app session.");
  }
  return result;
}
