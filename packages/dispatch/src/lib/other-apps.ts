export interface ConnectedAppSummary {
  id: string;
  name: string;
  description?: string;
  url: string;
  color?: string;
  source?: "builtin" | "custom" | "workspace";
}

export interface WorkspaceAppId {
  id: string;
  isDispatch?: boolean;
}

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
      if (!id || workspaceAppIds.has(id) || seen.has(id)) return false;
      if (app.source === "workspace") return false;
      if (!isHttpUrl(app.url)) return false;
      seen.add(id);
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
