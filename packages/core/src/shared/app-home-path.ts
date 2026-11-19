import { normalizeWorkspaceAppHomePath } from "./workspace-app-audience.js";

let cachedManifestHomePaths:
  | { appsJson: string; homePaths: Map<string, string> }
  | undefined;

function workspaceManifestHomePath(
  workspaceId: string | undefined,
  appsJson: string | undefined,
): string | undefined {
  if (!workspaceId || !appsJson?.trim()) return undefined;
  if (cachedManifestHomePaths?.appsJson !== appsJson) {
    const homePaths = new Map<string, string>();
    try {
      const parsed: unknown = JSON.parse(appsJson);
      const entries = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === "object" && "apps" in parsed
          ? (parsed as { apps?: unknown }).apps
          : null;
      if (Array.isArray(entries)) {
        for (const entry of entries) {
          if (!entry || typeof entry !== "object") continue;
          const record = entry as Record<string, unknown>;
          const id = typeof record.id === "string" ? record.id.trim() : "";
          if (!id || homePaths.has(id)) continue;
          homePaths.set(id, normalizeWorkspaceAppHomePath(record.homePath));
        }
      }
    } catch {
      // coercion-ok: a malformed manifest leaves the framework default in place.
    }
    cachedManifestHomePaths = { appsJson, homePaths };
  }
  return cachedManifestHomePaths.homePaths.get(workspaceId.trim());
}

export function resolveAppHomePath(
  app: { homePath?: string; workspaceId?: string },
  workspace?: { appsJson?: string | undefined },
): string {
  const configured = app.homePath?.trim();
  if (configured) return configured;
  return (
    workspaceManifestHomePath(app.workspaceId, workspace?.appsJson) ?? "/home"
  );
}
