import { AgentSidebar } from "@agent-native/core/client/agent-chat";
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
  IconArrowLeft,
  IconArrowUpRight,
  IconClockHour4,
  IconLock,
} from "@tabler/icons-react";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";

import { isEmbedSessionExpiredMessage } from "../lib/embed-session-recovery";
import {
  mergeChatFirstWorkspaceApps,
  workspaceAppDirectHref,
  workspaceAppEmbedTarget,
  workspaceAppHref,
  type WorkspaceAppSummary,
} from "../lib/workspace-apps";
import { DISPATCH_WORKSPACE_SSO_FLAG } from "../shared/feature-flags";
import { ActionQueryError } from "./action-query-error";
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
type WorkspaceAppAuthState = "unknown" | "authenticated" | "unauthenticated";

function resolveWorkspaceAppAuthState(
  rawUrl: string | null,
): WorkspaceAppAuthState {
  if (!rawUrl) return "unknown";
  try {
    const lastSegment = new URL(rawUrl, window.location.origin).pathname
      .split("/")
      .filter(Boolean)
      .at(-1)
      ?.toLowerCase();
    if (
      lastSegment === "sign-in" ||
      lastSegment === "login" ||
      lastSegment === "signup"
    ) {
      return "unauthenticated";
    }
    return "authenticated";
  } catch {
    return "unknown";
  }
}

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

export interface WorkspaceAppFrameApp {
  id: string;
  name: string;
  path?: string | null;
  url?: string | null;
}

interface WorkspaceAppFrameProps {
  app: WorkspaceAppFrameApp;
  /** Chat-first app tabs use their own route while standalone hosts use app metadata. */
  embedPath?: string;
  /** Chat-first app surfaces own the parent chat rail around the iframe. */
  chatSidebar?: boolean;
  copy?: ChatFirstCopy;
}

export function WorkspaceAppFrame({
  app,
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
  const [authState, setAuthState] = useState<WorkspaceAppAuthState>("unknown");
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
    const frame = embedFrameRef.current;
    let frameUrl = embedUrl;
    try {
      frameUrl = frame?.contentWindow?.location.href ?? frameUrl;
      // coercion-ok: Cross-origin frames cannot expose location; their auth state arrives by message.
    } catch {
      // Cross-origin app frames report their auth state through postMessage.
    }
    const nextAuthState = resolveWorkspaceAppAuthState(frameUrl);
    if (nextAuthState !== "unknown") setAuthState(nextAuthState);
  }, [embedUrl, isDirectFallback, postThemeToFrame]);
  const workspaceSsoEnabled = useFeatureFlag(DISPATCH_WORKSPACE_SSO_FLAG.key);
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
    if (!embedInput) return;
    let cancelled = false;
    setEmbedUrl(null);
    setEmbedError(null);
    setIsDirectFallback(false);
    setAuthState("unknown");
    const createSession = workspaceSsoEnabled
      ? createWorkspaceSsoEmbedSession
      : createEmbedSession;
    void createSession
      .mutateAsync(embedInput)
      .then((result) => {
        if (!cancelled) setEmbedUrl(result.startUrl);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setIsDirectFallback(true);
        setEmbedUrl(
          workspaceAppDirectHref(
            { path: app.path ?? "", url: app.url },
            embedPath ?? "/",
          ),
        );
        setEmbedError(
          cause instanceof Error ? cause : new Error(String(cause)),
        );
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
    workspaceSsoEnabled,
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
    const handleAuthState = (event: MessageEvent) => {
      const frame = embedFrameRef.current;
      if (!frame || event.source !== frame.contentWindow) return;
      if (event.data?.type !== "agentNative.authState") return;
      const status = event.data.data?.status;
      if (status === "authenticated" || status === "unauthenticated") {
        setAuthState(status);
      }
    };

    window.addEventListener("message", handleAuthState);
    return () => window.removeEventListener("message", handleAuthState);
  }, []);

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
    <AgentSidebar
      position="left"
      defaultOpen
      openStorageKey="dispatch-app-chat"
      storageKey={`dispatch-app-chat:${app.id}`}
      scope={{
        type: "workspace-app",
        id: app.id,
        label: app.name,
        contextKey: `workspace-app:${app.id}`,
      }}
      agentChatSurface="app"
      showTabBar
      suppressInlineOpenApp
      dynamicSuggestions={false}
      suggestions={[]}
      emptyStateText={`Ask about ${app.name}`}
      composerSlot={
        authState === "unauthenticated" ? (
          <div className="flex shrink-0 items-center px-3 pb-1">
            <button
              type="button"
              data-dispatch-app-sign-in
              aria-label={`Sign in to ${app.name} on the right`}
              title={`Sign in to ${app.name} on the right`}
              onClick={() => embedFrameRef.current?.focus()}
              className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full border border-border/70 bg-background/60 px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <IconLock size={12} stroke={1.8} />
              <span>Sign in on the right</span>
              <IconArrowUpRight size={12} stroke={1.8} />
            </button>
          </div>
        ) : null
      }
    >
      {appPane}
    </AgentSidebar>
  );
}

export function WorkspaceAppHost({ appId }: { appId?: string }) {
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
        <WorkspaceAppFrame app={app} />
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
