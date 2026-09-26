interface WorkspaceAppManifestEntry {
  id?: string;
  path?: unknown;
  url?: unknown;
}

interface BuiltinAgentEntry {
  id: string;
  url?: string | null;
}

interface ResolveCatchAllTargetOptions {
  workspaceApps?: WorkspaceAppManifestEntry[] | null;
  builtinAgents?: BuiltinAgentEntry[] | null;
}

function validatedAbsoluteUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return undefined;
    }
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

export function resolveCatchAllTarget(
  appId: string,
  options: ResolveCatchAllTargetOptions = {},
): string | null {
  const apps = options.workspaceApps;
  if (apps) {
    const app = apps.find((entry) => entry?.id === appId);
    if (app) {
      const url = validatedAbsoluteUrl(app.url);
      if (url) {
        return url;
      }
      if (typeof app.path === "string" && app.path.trim()) {
        const normalized = app.path.trim().replace(/^[/\\]+/, "/");
        return normalized.startsWith("/") ? normalized : `/${normalized}`;
      }
      return `/${appId}`;
    }
  }
  const builtin = (options.builtinAgents ?? []).find(
    (agent) => agent.id === appId,
  );
  return builtin?.url ?? null;
}

export async function resolveServerCatchAllTarget(
  appId: string,
): Promise<string | null> {
  if (!import.meta.env.SSR) return null;
  const { getBuiltinAgents, loadWorkspaceAppsManifest, normalizeAgentId } =
    await import("@agent-native/core/server/agent-discovery");
  return resolveCatchAllTarget(normalizeAgentId(appId), {
    workspaceApps: await loadWorkspaceAppsManifest(),
    builtinAgents: getBuiltinAgents("dispatch"),
  });
}
