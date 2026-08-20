import {
  normalizeWorkspaceAppConfigs,
  WORKSPACE_APP_LIST_FLAG_KEY,
} from "@agent-native/shared-app-config";
import type { Session } from "electron";

import type { DesktopWorkspaceAppListResult } from "../../shared/ipc-channels.js";

const FEATURE_FLAGS_PATH = "/_agent-native/actions/get-feature-flags";
const WORKSPACE_APPS_PATH =
  "/_agent-native/actions/list-workspace-apps?includeAgentCards=false&audience=all";

type WorkspaceSession = Pick<Session, "fetch"> &
  Partial<Pick<Session, "cookies">>;

function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

async function getJson(
  session: WorkspaceSession,
  origin: string,
  path: string,
): Promise<unknown> {
  const cookieHeader = await getCookieHeader(session, origin);
  const url = `${origin}${path}`;
  const headers = {
    accept: "application/json",
    ...(cookieHeader ? { Cookie: cookieHeader } : {}),
  };
  let response = await session.fetch(url, {
    method: "GET",
    credentials: "include",
    headers,
  });
  let payload = await response.json();
  if (
    cookieHeader &&
    (response.status === 401 || isUnauthenticatedPayload(payload))
  ) {
    try {
      // Electron's isolated Session transport can return an unauthenticated
      // response for a cookie that succeeds through the main-process fetch.
      const fallbackResponse = await fetch(url, {
        method: "GET",
        headers,
      });
      const fallbackPayload = await fallbackResponse.json();
      response = fallbackResponse;
      payload = fallbackPayload;
    } catch (error) {
      // Preserve the primary response as the authoritative failure when the
      // fallback transport is unavailable.
      console.debug(
        "[desktop workspace apps] main-process fallback unavailable",
        {
          reason: error instanceof Error ? error.message : "unknown error",
        },
      );
    }
  }
  if (!response.ok)
    throw new Error(`Workspace app request failed: ${response.status}`);
  return payload;
}

function isUnauthenticatedPayload(value: unknown): boolean {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as Record<string, unknown>).error === "Not authenticated"
  );
}

async function getCookieHeader(
  session: WorkspaceSession,
  origin: string,
): Promise<string | undefined> {
  if (!session.cookies?.get) return undefined;
  const hostname = new URL(origin).hostname.toLowerCase();
  const cookies = await session.cookies.get({});
  const matchingCookies = cookies.filter((cookie) => {
    const domain = (cookie.domain ?? "").replace(/^\./, "").toLowerCase();
    return Boolean(
      domain &&
      (hostname === domain ||
        (!cookie.hostOnly && hostname.endsWith(`.${domain}`))),
    );
  });
  const header = matchingCookies
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
  return header || undefined;
}

/**
 * Read the rollout and inventory through the authenticated Dispatch session.
 * The renderer receives only launch metadata, never the session cookie or raw
 * action body.
 */
export async function loadDesktopWorkspaceApps(options: {
  identitySession: WorkspaceSession;
  dispatchOrigin: string;
}): Promise<DesktopWorkspaceAppListResult> {
  const origin = normalizeOrigin(options.dispatchOrigin);
  if (!origin) return { enabled: false, apps: [] };

  try {
    const flags = await getJson(
      options.identitySession,
      origin,
      FEATURE_FLAGS_PATH,
    );
    if (
      !flags ||
      typeof flags !== "object" ||
      (flags as Record<string, unknown>)[WORKSPACE_APP_LIST_FLAG_KEY] !== true
    ) {
      return { enabled: false, apps: [] };
    }

    const inventory = await getJson(
      options.identitySession,
      origin,
      WORKSPACE_APPS_PATH,
    );
    const apps = normalizeWorkspaceAppConfigs(inventory, { baseUrl: origin });
    return {
      enabled: true,
      apps: apps.map((app) => ({ ...app, workspaceSso: true })),
    };
  } catch (error) {
    // Native shells fail closed while the rollout or session is unavailable.
    console.warn("[desktop workspace apps] failed to load inventory", {
      reason: error instanceof Error ? error.message : "unknown error",
    });
    return { enabled: false, apps: [] };
  }
}
