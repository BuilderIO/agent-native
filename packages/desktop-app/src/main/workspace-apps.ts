import {
  normalizeWorkspaceAppConfigs,
  WORKSPACE_APP_LIST_FLAG_KEY,
} from "@agent-native/shared-app-config";
import type { Session } from "electron";

import type { DesktopWorkspaceAppListResult } from "../../shared/ipc-channels.js";

const FEATURE_FLAGS_PATH = "/_agent-native/actions/get-feature-flags";
const WORKSPACE_APPS_PATH =
  "/_agent-native/actions/list-workspace-apps?includeAgentCards=false&audience=all";

type WorkspaceSession = Pick<Session, "fetch">;

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
  const response = await session.fetch(`${origin}${path}`, {
    method: "GET",
    headers: { accept: "application/json" },
  });
  if (!response.ok)
    throw new Error(`Workspace app request failed: ${response.status}`);
  return response.json();
}

/**
 * Read the rollout and inventory through the identity session. The renderer
 * receives only launch metadata, never the session cookie or raw action body.
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
    return {
      enabled: true,
      apps: normalizeWorkspaceAppConfigs(inventory, { baseUrl: origin }),
    };
  } catch {
    // Native shells fail closed while the rollout or session is unavailable.
    return { enabled: false, apps: [] };
  }
}
