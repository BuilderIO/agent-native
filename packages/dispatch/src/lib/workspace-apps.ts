import { CHAT_FIRST_DEFAULT_APP_IDS } from "@agent-native/core/client/chat-first";
import { withBuilderUtmTrackingParams } from "@agent-native/core/shared/builder-link-tracking";

export interface WorkspaceAppSummary {
  id: string;
  name: string;
  description?: string;
  path: string;
  url?: string | null;
  isDispatch?: boolean;
  audience?: "internal" | "public";
  publicPaths?: string[];
  protectedPaths?: string[];
  status?: "ready" | "pending";
  statusLabel?: string;
  builderUrl?: string | null;
  branchName?: string | null;
  createdAt?: string | null;
  createdBy?: string | null;
  owner?: string | null;
  teams?: string[];
  agentCardUrl?: string | null;
  agentCardReachable?: boolean;
  a2aEndpointUrl?: string | null;
  agentName?: string | null;
  agentSkillsCount?: number | null;
  archived?: boolean;
}

export function workspaceAppRoute(appId: string): string {
  return `/apps/${encodeURIComponent(appId)}`;
}

export function workspaceAppIdFromRoute(pathname: string): string | null {
  const match = pathname.match(/^\/apps\/([^/]+)(?:\/|$)/);
  if (!match) return null;
  try {
    const appId = decodeURIComponent(match[1]).trim();
    return appId || null;
  } catch {
    // coercion-ok: malformed app routes are inactive, not app ids.
    return null;
  }
}

export function workspaceAppHref(app: WorkspaceAppSummary): string | null {
  if (app.status === "pending") {
    return app.builderUrl
      ? withBuilderUtmTrackingParams(app.builderUrl, {
          campaign: "product",
          content: "dispatch_branch",
        })
      : null;
  }
  return app.path || app.url || null;
}

export function isPendingBuilderHref(app: WorkspaceAppSummary): boolean {
  return app.status === "pending" && !!app.builderUrl;
}

/**
 * Keep the chat-first rail useful before a workspace manifest is populated.
 * Mounted workspace rows still win, so custom names and routes remain the
 * source of truth once an app exists in the workspace.
 */
export function mergeChatFirstWorkspaceApps(
  apps: readonly WorkspaceAppSummary[] | undefined,
): WorkspaceAppSummary[] {
  const merged = new Map<string, WorkspaceAppSummary>();
  for (const id of CHAT_FIRST_DEFAULT_APP_IDS) {
    merged.set(id, {
      id,
      name: id.charAt(0).toUpperCase() + id.slice(1),
      path: `/${id}`,
      url: null,
      status: "ready",
    });
  }
  for (const app of apps ?? []) merged.set(app.id, app);

  return [...merged.values()];
}
