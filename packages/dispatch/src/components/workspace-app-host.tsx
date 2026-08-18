import { AgentSidebar } from "@agent-native/core/client/agent-chat";
import { agentNativePath } from "@agent-native/core/client/api-path";
import {
  ChatFirstAppPane,
  defaultChatFirstCopy,
  type ChatFirstCopy,
} from "@agent-native/core/client/chat-first";
import { useFeatureFlag } from "@agent-native/core/client/feature-flags";
import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { withBuilderUtmTrackingParams } from "@agent-native/core/shared/builder-link-tracking";
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconClockHour4,
} from "@tabler/icons-react";
import { useTheme } from "next-themes";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link } from "react-router";

import { isEmbedSessionExpiredMessage } from "../lib/embed-session-recovery";
import {
  mergeChatFirstWorkspaceApps,
  isWorkspaceSsoApp,
  navigateToWorkspaceApp,
  shouldOpenWorkspaceAppInTopWindow,
  workspaceAppDirectHref,
  workspaceAppEmbedTarget,
  workspaceAppHref,
  type WorkspaceAppSummary,
} from "../lib/workspace-apps";
import { DISPATCH_WORKSPACE_SSO_FLAG } from "../shared/feature-flags";
import { workspaceAppChatProxyPath } from "../shared/workspace-app-chat";
import { ActionQueryError } from "./action-query-error";
import { Alert, AlertDescription } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";

interface EmbedSessionResult {
  startUrl: string;
}

interface EmbedSessionInput {
  app?: string;
  path?: string;
  url?: string;
  chrome: "minimal";
}

interface GrantedWorkspaceAppSummary {
  id: string;
  name: string;
  url?: string | null;
}

interface GrantedWorkspaceAppsResult {
  apps: GrantedWorkspaceAppSummary[];
}

type WorkspaceAppTheme = "light" | "dark";
function buildWorkspaceAppThemeUpdate(theme: WorkspaceAppTheme) {
  return {
    type: "agent-native-theme-update" as const,
    theme,
    isDark: theme === "dark",
  };
}

export function buildChatFirstEmbedSessionInput(
  appId: string,
  path: string,
): EmbedSessionInput {
  return { app: appId, path, chrome: "minimal" };
}

async function readWorkspaceAppChatProxyError(
  response: Response,
): Promise<string> {
  let body: string;
  try {
    body = await response.text();
  } catch {
    // coercion-ok: an unreadable body is reported as such, not as an empty error.
    return `Agent chat proxy returned ${response.status} with an unreadable body.`;
  }
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    if (typeof parsed.error === "string" && parsed.error) return parsed.error;
  } catch {
    // coercion-ok: a non-JSON body is still reportable as the status line.
  }
  return body.trim() || `Agent chat proxy returned ${response.status}.`;
}

/**
 * Point the app pane's chat rail at the app's OWN agent through the Dispatch
 * proxy, and prove the proxy answers before claiming it works. A rail that
 * quietly fell back to Dispatch's agent would look identical while running the
 * wrong tools, instructions, and app resources, so a failed probe is a visible
 * error state instead.
 */
function useWorkspaceAppChatApi(appId: string) {
  const apiUrl = useMemo(
    () => agentNativePath(workspaceAppChatProxyPath(appId)),
    [appId],
  );
  const [attempt, setAttempt] = useState(0);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setUnavailable(false);
    // `/mode` is the app's own dev-mode surface: reaching it proves the proxy
    // minted an app session and the app's agent-chat routes answer.
    void fetch(`${apiUrl}/mode`, { credentials: "include" })
      .then(async (response) => {
        if (response.ok) return;
        throw new Error(await readWorkspaceAppChatProxyError(response));
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        console.warn(
          `[dispatch] app chat proxy unavailable for ${appId}`,
          cause,
        );
        setUnavailable(true);
      });
    return () => {
      cancelled = true;
    };
  }, [apiUrl, appId, attempt]);

  return {
    apiUrl,
    unavailable,
    retry: useCallback(() => setAttempt((value) => value + 1), []),
  };
}

export interface WorkspaceAppChatRailProps {
  appId: string;
  appName: string;
  children: ReactNode;
  copy?: ChatFirstCopy;
  agentPageHref?: string;
  onFullscreenRequest?: () => void;
}

/**
 * The chat beside an open workspace app. Every surface that hosts an app pane
 * must go through here so the rail is always the app's own agent — same tools,
 * AGENTS.md, skills, app-scoped resources, and dev-mode surface as the app's
 * native chat — and so an unreachable app is one visible error state rather
 * than a per-surface silent handoff back to Dispatch's agent.
 */
export function WorkspaceAppChatRail({
  appId,
  appName,
  children,
  copy = defaultChatFirstCopy,
  agentPageHref,
  onFullscreenRequest,
}: WorkspaceAppChatRailProps) {
  const t = useT();
  const appChat = useWorkspaceAppChatApi(appId);

  if (appChat.unavailable) {
    return (
      <div className="flex h-full min-h-0">
        <div
          data-dispatch-app-chat-unavailable
          className="w-88 shrink-0 overflow-auto border-r p-4"
        >
          <Alert variant="destructive">
            <IconAlertTriangle className="size-4" />
            <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
              <span>
                {t("dispatch.pages.appChatUnavailable", {
                  defaultValue:
                    "Dispatch could not connect to {{name}}'s agent, so its chat is unavailable here.",
                  name: appName,
                })}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={appChat.retry}
              >
                {copy("retry")}
              </Button>
            </AlertDescription>
          </Alert>
        </div>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    );
  }

  return (
    <AgentSidebar
      position="left"
      defaultOpen
      openStorageKey="dispatch-app-chat"
      storageKey={`dispatch-app-chat:${appId}`}
      scope={{
        type: "workspace-app",
        id: appId,
        label: appName,
        contextKey: `workspace-app:${appId}`,
      }}
      // The app's own server answers this chat, so its tools, AGENTS.md,
      // skills, app-scoped resources, and dev-mode surface are the real ones
      // rather than a copy maintained inside Dispatch.
      apiUrl={appChat.apiUrl}
      agentChatSurface="app"
      showTabBar
      suppressInlineOpenApp
      dynamicSuggestions={false}
      suggestions={[]}
      emptyStateText={`Ask about ${appName}`}
      {...(agentPageHref ? { agentPageHref } : {})}
      {...(onFullscreenRequest ? { onFullscreenRequest } : {})}
    >
      {children}
    </AgentSidebar>
  );
}

export interface WorkspaceAppFrameApp {
  id: string;
  name: string;
  path?: string | null;
  url?: string | null;
}

interface WorkspaceAppFrameProps {
  app: WorkspaceAppFrameApp;
  navigateToTopWindow?: (href: string) => boolean | void;
  /** Chat-first app tabs use their own route while standalone hosts use app metadata. */
  embedPath?: string;
  /** Chat-first app surfaces own the parent chat rail around the iframe. */
  chatSidebar?: boolean;
  copy?: ChatFirstCopy;
}

export function WorkspaceAppFrame({
  app,
  navigateToTopWindow = navigateToWorkspaceApp,
  embedPath,
  chatSidebar = false,
  copy = defaultChatFirstCopy,
}: WorkspaceAppFrameProps) {
  const { resolvedTheme } = useTheme();
  const theme: WorkspaceAppTheme =
    resolvedTheme === "dark" || resolvedTheme === "light"
      ? resolvedTheme
      : typeof document !== "undefined" &&
          document.documentElement.classList.contains("dark")
        ? "dark"
        : "light";
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);
  const [embedError, setEmbedError] = useState<Error | null>(null);
  const [isDirectFallback, setIsDirectFallback] = useState(false);
  const [embedAttempt, setEmbedAttempt] = useState(0);
  const [topWindowNavigationFailed, setTopWindowNavigationFailed] =
    useState(false);
  const embedFrameRef = useRef<HTMLIFrameElement>(null);
  const postThemeToFrame = useCallback(() => {
    embedFrameRef.current?.contentWindow?.postMessage(
      buildWorkspaceAppThemeUpdate(theme),
      "*",
    );
  }, [theme]);
  const handleFrameLoad = useCallback(() => {
    postThemeToFrame();
    if (isDirectFallback) setEmbedError(null);
  }, [isDirectFallback, postThemeToFrame]);
  const workspaceSsoEnabled = useFeatureFlag(DISPATCH_WORKSPACE_SSO_FLAG.key);
  const useWorkspaceSso = workspaceSsoEnabled && isWorkspaceSsoApp(app);
  const createEmbedSession = useActionMutation<
    EmbedSessionResult,
    EmbedSessionInput
  >("create_embed_session", {
    skipActionQueryInvalidation: true,
  });
  const createWorkspaceSsoEmbedSession = useActionMutation<
    EmbedSessionResult,
    EmbedSessionInput
  >("create-workspace-app-embed-session", {
    skipActionQueryInvalidation: true,
  });
  const appHref = workspaceAppHref({
    id: app.id,
    name: app.name,
    path: app.path ?? "",
    url: app.url,
  });
  const topWindowHref = useMemo(() => {
    if (embedPath !== undefined) {
      return workspaceAppDirectHref(
        { path: app.path, url: app.url },
        embedPath,
      );
    }

    const target = workspaceAppEmbedTarget({
      path: app.path ?? "",
      url: app.url,
    });
    return target.url ?? target.path ?? null;
  }, [app.path, app.url, embedPath]);
  const openInTopWindow = shouldOpenWorkspaceAppInTopWindow();
  const embedInput = useMemo<EmbedSessionInput | null>(() => {
    if (embedPath !== undefined) {
      return buildChatFirstEmbedSessionInput(app.id, embedPath);
    }
    if (!appHref) return null;
    return {
      app: app.id,
      ...workspaceAppEmbedTarget({ path: app.path ?? "", url: app.url }),
      chrome: "minimal",
    };
  }, [app.id, app.path, app.url, appHref, embedPath]);

  useEffect(() => {
    if (!openInTopWindow) {
      setTopWindowNavigationFailed(false);
      return;
    }
    if (!topWindowHref) {
      setTopWindowNavigationFailed(true);
      return;
    }

    let didNavigate = false;
    try {
      didNavigate = navigateToTopWindow(topWindowHref) !== false;
    } catch {
      didNavigate = false;
    }
    setTopWindowNavigationFailed(!didNavigate);
  }, [navigateToTopWindow, openInTopWindow, topWindowHref]);

  useEffect(() => {
    if (!embedInput || (openInTopWindow && !topWindowNavigationFailed)) return;
    let cancelled = false;
    setEmbedUrl(null);
    setEmbedError(null);
    setIsDirectFallback(false);
    const createSession = useWorkspaceSso
      ? createWorkspaceSsoEmbedSession
      : createEmbedSession;
    void createSession
      .mutateAsync(embedInput)
      .then((result) => {
        if (!cancelled) setEmbedUrl(result.startUrl);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        const error = cause instanceof Error ? cause : new Error(String(cause));
        if (useWorkspaceSso) {
          // An SSO-enabled pane must never fall back to the child app's
          // unauthenticated shell. Keep the parent-owned retry surface in
          // place so a transient exchange failure cannot expose another
          // login form.
          setIsDirectFallback(false);
          setEmbedUrl(null);
          setEmbedError(error);
          return;
        }
        setIsDirectFallback(true);
        setEmbedUrl(
          workspaceAppDirectHref(
            { path: app.path ?? "", url: app.url },
            embedPath ?? "/",
          ),
        );
        setEmbedError(error);
      });
    return () => {
      cancelled = true;
    };
  }, [
    app.id,
    app.path,
    app.url,
    createEmbedSession.mutateAsync,
    createWorkspaceSsoEmbedSession.mutateAsync,
    embedInput,
    embedPath,
    embedAttempt,
    openInTopWindow,
    topWindowNavigationFailed,
    useWorkspaceSso,
  ]);

  useEffect(() => {
    const handleEmbedSessionExpired = (event: MessageEvent) => {
      if (
        !isEmbedSessionExpiredMessage(event, embedFrameRef.current, embedUrl)
      ) {
        return;
      }
      setEmbedAttempt((attempt) => attempt + 1);
    };

    window.addEventListener("message", handleEmbedSessionExpired);
    return () =>
      window.removeEventListener("message", handleEmbedSessionExpired);
  }, [embedUrl]);

  useEffect(() => {
    postThemeToFrame();
  }, [embedUrl, postThemeToFrame]);

  const appPane = (
    <ChatFirstAppPane
      app={app}
      status={
        embedUrl
          ? "ready"
          : embedError
            ? "error"
            : embedInput
              ? "loading"
              : "unresolved"
      }
      embedUrl={embedUrl}
      errorMessage={embedError?.message}
      onRetry={
        embedInput ? () => setEmbedAttempt((attempt) => attempt + 1) : undefined
      }
      renderEmbed={({ url, title }) => (
        <iframe
          key={url + ":" + embedAttempt}
          data-dispatch-workspace-app-frame
          src={url}
          title={title ?? app.name}
          ref={embedFrameRef}
          onLoad={handleFrameLoad}
          referrerPolicy="no-referrer"
          allow="clipboard-read; clipboard-write"
          className="h-full w-full border-0 bg-background"
        />
      )}
      copy={copy}
    />
  );

  if (!chatSidebar) return appPane;

  return (
    <WorkspaceAppChatRail appId={app.id} appName={app.name} copy={copy}>
      {appPane}
    </WorkspaceAppChatRail>
  );
}

export function WorkspaceAppHost({
  appId,
  navigateToTopWindow = navigateToWorkspaceApp,
}: {
  appId?: string;
  navigateToTopWindow?: (href: string) => boolean | void;
}) {
  const t = useT();
  const workspaceAppsQuery = useActionQuery<WorkspaceAppSummary[]>(
    "list-workspace-apps",
    { includeAgentCards: false },
  );
  const grantedAppsQuery = useActionQuery<GrantedWorkspaceAppsResult>(
    "list_apps",
    {},
  );
  const apps = useMemo(() => {
    const merged = new Map<string, WorkspaceAppSummary>();

    for (const app of mergeChatFirstWorkspaceApps(workspaceAppsQuery.data)) {
      merged.set(app.id.trim().toLowerCase(), app);
    }
    for (const app of grantedAppsQuery.data?.apps ?? []) {
      const id = app.id.trim();
      if (!id || merged.has(id.toLowerCase())) continue;
      merged.set(id.toLowerCase(), {
        id,
        name: app.name.trim() || id,
        path: "",
        url: app.url?.trim() || null,
        status: "ready",
      });
    }

    return [...merged.values()];
  }, [grantedAppsQuery.data?.apps, workspaceAppsQuery.data]);
  const app = useMemo(
    () =>
      apps.find(
        (item) => item.id.trim().toLowerCase() === appId?.trim().toLowerCase(),
      ) ?? null,
    [appId, apps],
  );
  const isLoading = workspaceAppsQuery.isLoading || grantedAppsQuery.isLoading;
  const queryError = workspaceAppsQuery.isError
    ? workspaceAppsQuery.error
    : grantedAppsQuery.isError
      ? grantedAppsQuery.error
      : null;

  if (queryError && !app) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center p-6">
        <div className="w-full max-w-2xl">
          <ActionQueryError
            error={queryError}
            onRetry={() => {
              void workspaceAppsQuery.refetch();
              void grantedAppsQuery.refetch();
            }}
          />
        </div>
      </div>
    );
  }

  if (isLoading && !app) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center p-6">
        <div className="w-full max-w-2xl space-y-3 rounded-xl border bg-card p-6">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>
    );
  }

  if (!app) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center p-6">
        <div className="w-full max-w-2xl rounded-xl border bg-card p-6">
          <Button asChild size="sm" variant="ghost" className="-ml-2 mb-4">
            <Link to="/apps">
              <IconArrowLeft size={15} className="mr-1.5" />
              {t("dispatch.nav.apps")}
            </Link>
          </Button>
          <div className="space-y-3">
            <h2 className="text-base font-semibold text-foreground">
              {t("dispatch.pages.appNotFound")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t("dispatch.pages.pageNotFoundDescription")}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (app.status === "pending") {
    return (
      <div className="flex h-full min-h-0 items-center justify-center p-6">
        <div className="w-full max-w-2xl rounded-xl border bg-card p-6">
          <Button asChild size="sm" variant="ghost" className="-ml-2 mb-4">
            <Link to="/apps">
              <IconArrowLeft size={15} className="mr-1.5" />
              {t("dispatch.nav.apps")}
            </Link>
          </Button>
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-foreground">
                {app.name}
              </h2>
              <Badge
                variant="outline"
                className="gap-1 border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
              >
                <IconClockHour4 size={12} />
                {t("dispatch.pages.building")}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {t("dispatch.pages.appBuildingPrefix")}{" "}
              <span className="font-mono text-foreground">{app.path}</span>{" "}
              {t("dispatch.pages.appBuildingSuffix")}
            </p>
            {app.builderUrl ? (
              <Button asChild>
                <a
                  href={withBuilderUtmTrackingParams(app.builderUrl, {
                    campaign: "product",
                    content: "dispatch_branch",
                  })}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("dispatch.pages.openBuilderBranch", {
                    defaultValue: "Open in Builder",
                  })}
                </a>
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      data-dispatch-workspace-app-host
      className="flex h-full min-h-0 flex-col bg-background"
    >
      <div className="min-h-0 flex-1 bg-muted/20">
        <WorkspaceAppFrame
          app={app}
          navigateToTopWindow={navigateToTopWindow}
        />
      </div>
    </div>
  );
}

const MAX_KEEP_ALIVE_APPS = 3;

export function WorkspaceAppKeepAlive({
  activeAppId,
}: {
  activeAppId: string | null;
}) {
  const [visitedAppIds, setVisitedAppIds] = useState<string[]>(() =>
    activeAppId ? [activeAppId] : [],
  );

  useEffect(() => {
    if (!activeAppId) return;
    setVisitedAppIds((current) =>
      [activeAppId, ...current.filter((appId) => appId !== activeAppId)].slice(
        0,
        MAX_KEEP_ALIVE_APPS,
      ),
    );
  }, [activeAppId]);

  const renderedAppIds =
    activeAppId && !visitedAppIds.includes(activeAppId)
      ? [activeAppId, ...visitedAppIds]
      : visitedAppIds;

  return (
    <div
      data-dispatch-workspace-app-cache
      className={activeAppId ? "absolute inset-0 overflow-hidden" : "hidden"}
    >
      {renderedAppIds.map((appId) => {
        const active = appId === activeAppId;
        return (
          <div
            key={appId}
            data-dispatch-workspace-app-cache-entry={appId}
            aria-hidden={!active}
            className={active ? "h-full min-h-0" : "hidden"}
          >
            <WorkspaceAppHost appId={appId} />
          </div>
        );
      })}
    </div>
  );
}
