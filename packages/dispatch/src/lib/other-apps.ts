import {
  defaultWorkspaceAppUrl,
  isDefaultWorkspaceAppHiddenId,
} from "./workspace-apps";

export interface ConnectedAppSummary {
  id: string;
  name: string;
  description?: string;
  url: string;
  homeUrl?: string;
  color?: string;
  source?: "builtin" | "custom" | "workspace";
  /** Set by list-connected-agents when the organization hides hosted apps. */
  hiddenFromLaunchers?: boolean;
}

export interface WorkspaceAppId {
  id: string;
  isDispatch?: boolean;
}

const HIDDEN_OTHER_APP_IDS = new Set(["crm", "research"]);

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function filterOtherApps(
  connectedApps: ConnectedAppSummary[],
  workspaceApps: WorkspaceAppId[],
): ConnectedAppSummary[] {
  const workspaceAppIds = new Set([
    "dispatch",
    ...workspaceApps.map((app) => app.id.trim().toLowerCase()),
  ]);
  const seen = new Set<string>();

  return connectedApps
    .filter((app) => {
      const id = app.id.trim().toLowerCase();
      if (
        !id ||
        isDefaultWorkspaceAppHiddenId(id) ||
        HIDDEN_OTHER_APP_IDS.has(id) ||
        workspaceAppIds.has(id) ||
        seen.has(id)
      )
        return false;
      if (app.source !== "custom") return false;
      if (!isHttpUrl(app.url)) return false;
      seen.add(id);
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Hosted apps for launcher surfaces. Rows the organization hides are left out
 * unless `includeHiddenFromLaunchers` is set, which callers that resolve an
 * app id to open (pane restore, `open_app`) need.
 */
export function filterBuiltInApps(
  connectedApps: ConnectedAppSummary[],
  workspaceApps: WorkspaceAppId[],
  { includeHiddenFromLaunchers = false } = {},
): ConnectedAppSummary[] {
  const workspaceAppIds = new Set([
    "dispatch",
    ...workspaceApps.map((app) => app.id.trim().toLowerCase()),
  ]);
  const seen = new Set<string>();

  return connectedApps
    .filter((app) => {
      const id = app.id.trim().toLowerCase();
      const url = app.homeUrl?.trim() || app.url;
      if (
        !id ||
        app.source !== "builtin" ||
        (app.hiddenFromLaunchers && !includeHiddenFromLaunchers) ||
        isDefaultWorkspaceAppHiddenId(id) ||
        workspaceAppIds.has(id) ||
        seen.has(id) ||
        !isHttpUrl(url)
      ) {
        return false;
      }
      seen.add(id);
      return true;
    })
    .map((app) => ({
      ...app,
      url: defaultWorkspaceAppUrl(app.url),
      ...(app.homeUrl ? { homeUrl: defaultWorkspaceAppUrl(app.homeUrl) } : {}),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
