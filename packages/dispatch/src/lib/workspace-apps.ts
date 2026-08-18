import { CHAT_FIRST_DEFAULT_APP_IDS } from "@agent-native/core/client/chat-first";
import { withBuilderUtmTrackingParams } from "@agent-native/core/shared/builder-link-tracking";

import { CANONICAL_WORKSPACE_SSO_APP_ORIGINS } from "../shared/workspace-sso";

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

interface WorkspaceAppHrefSource {
  path?: string | null;
  url?: string | null;
}

export function isDispatchWorkspaceAppId(appId: string): boolean {
  return appId.trim().toLowerCase() === "dispatch";
}

/**
 * The workspace SSO action only accepts the exact first-party app identities
 * registered by Dispatch. Mounted workspace apps use the regular granted-app
 * session flow until they receive an explicit identity registration.
 */
export function isWorkspaceSsoAppId(appId: string): boolean {
  return Object.prototype.hasOwnProperty.call(
    CANONICAL_WORKSPACE_SSO_APP_ORIGINS,
    appId.trim().toLowerCase(),
  );
}

/**
 * A mounted app URL leaves Dispatch's `/apps/:id` host route. Keep this check
 * based on the published URL path so canonical first-party origins continue
 * to use the inline pane while custom workspace apps open at their own mount.
 */
export function isPathMountedWorkspaceApp(
  app: WorkspaceAppHrefSource,
): boolean {
  const rawUrl = app.url?.trim();
  if (rawUrl) {
    try {
      const pathname = new URL(rawUrl).pathname.replace(/\/+$/, "") || "/";
      return pathname !== "/";
    } catch {
      // Fall through to the mounted path for relative manifest values.
    }
  }
  const path = app.path?.trim().replace(/\/+$/, "") || "/";
  return path !== "/";
}

export function isDefaultWorkspaceAppHiddenId(appId: string): boolean {
  const normalized = appId.trim().toLowerCase();
  return normalized === "chat" || isDispatchWorkspaceAppId(normalized);
}

export function isWorkspaceAppVisibleInDefaultLaunchers(
  app: Pick<WorkspaceAppSummary, "id" | "isDispatch">,
): boolean {
  return !app.isDispatch && !isDefaultWorkspaceAppHiddenId(app.id);
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

export function workspaceAppEmbedTarget(
  app: Pick<WorkspaceAppSummary, "path" | "url">,
): { path?: string; url?: string } {
  const url = app.url?.trim();
  if (url) return { url };

  const path = app.path.trim();
  return path.startsWith("/") ? { path } : path ? { url: path } : {};
}

/**
 * Resolve an app route without an embed ticket so the target can render its
 * own error document when session setup fails.
 */
export function workspaceAppDirectHref(
  app: WorkspaceAppHrefSource,
  targetPath: string,
): string | null {
  const target = targetPath.trim();
  if (!target || !target.startsWith("/") || target.startsWith("//")) {
    return null;
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(target, "https://agent-native.invalid");
  } catch {
    // coercion-ok: invalid relative target input has no safe href.
    return null;
  }
  const targetPathname = targetUrl.pathname || "/";

  let absoluteBase: URL | null = null;
  const rawUrl = app.url?.trim();
  if (rawUrl) {
    try {
      const parsedBase = new URL(rawUrl);
      if (parsedBase.protocol === "http:" || parsedBase.protocol === "https:") {
        absoluteBase = parsedBase;
      }
      // coercion-ok: invalid app URLs use the mounted path fallback below.
    } catch {
      absoluteBase = null;
    }
  }

  const mountedPath = app.path?.trim();
  const basePath = absoluteBase
    ? absoluteBase.pathname
    : mountedPath
      ? `/${mountedPath.replace(/^[/\\]+/, "").split(/[?#]/, 1)[0]}`
      : null;
  if (!basePath) return null;

  const normalizedBasePath = basePath.replace(/\/+$/, "") || "/";
  const targetIsMountedPath =
    normalizedBasePath !== "/" &&
    (targetPathname === normalizedBasePath ||
      targetPathname.startsWith(`${normalizedBasePath}/`));
  const resolvedPath = targetIsMountedPath
    ? targetPathname
    : normalizedBasePath === "/"
      ? targetPathname
      : targetPathname === "/"
        ? normalizedBasePath
        : `${normalizedBasePath}/${targetPathname.replace(/^\/+/, "")}`;

  if (absoluteBase) {
    absoluteBase.pathname = resolvedPath;
    absoluteBase.search = targetUrl.search;
    absoluteBase.hash = targetUrl.hash;
    return absoluteBase.toString();
  }

  return `${resolvedPath}${targetUrl.search}${targetUrl.hash}`;
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
      // The five default rows are hosted sibling apps, not routes owned by
      // Dispatch. Keep a mounted path for legacy callers, but give embed
      // session resolution the exact canonical origin.
      path: "/",
      url: CANONICAL_WORKSPACE_SSO_APP_ORIGINS[id],
      status: "ready",
    });
  }
  for (const app of apps ?? []) merged.set(app.id, app);

  return [...merged.values()];
}
