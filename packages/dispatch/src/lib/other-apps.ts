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

/**
 * Apps outside this workspace that the chat-first pane can open: first-party
 * hosted apps and apps connected from another workspace. None while the
 * mounted list is loading, so an external row never stands in for a mounted
 * app with the same id. When the mounted list is unreadable they are all
 * kept, since no mounted app can be shown to shadow them.
 */
export function chatFirstExternalApps(
  connectedApps: ConnectedAppSummary[],
  workspaceApps: WorkspaceAppId[] | "loading" | "unreadable",
): {
  id: string;
  name: string;
  description?: string;
  url: string;
  source: "builtin" | "connected";
  hiddenFromLaunchers?: boolean;
}[] {
  if (workspaceApps === "loading") return [];
  const mounted = workspaceApps === "unreadable" ? [] : workspaceApps;
  const summary = (app: ConnectedAppSummary, url: string) => ({
    id: app.id,
    name: app.name,
    ...(app.description === undefined ? {} : { description: app.description }),
    url,
  });
  return [
    ...filterBuiltInApps(connectedApps, mounted, {
      includeHiddenFromLaunchers: true,
    }).map((app) => ({
      ...summary(app, app.homeUrl?.trim() || app.url),
      source: "builtin" as const,
      ...(app.hiddenFromLaunchers ? { hiddenFromLaunchers: true } : {}),
    })),
    ...filterOtherApps(connectedApps, mounted).map((app) => ({
      ...summary(app, app.url),
      source: "connected" as const,
    })),
  ];
}
