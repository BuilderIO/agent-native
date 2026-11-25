import { sendToAgentChatAndConfirm } from "@agent-native/core/client/agent-chat";
import { agentNativePath } from "@agent-native/core/client/api-path";
import { useFeatureFlag } from "@agent-native/core/client/feature-flags";
import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { AGENT_NATIVE_WORKSPACE_APP_ROUTE_MESSAGE_TYPE } from "@agent-native/core/client/navigation";
import { withBuilderUtmTrackingParams } from "@agent-native/core/shared/builder-link-tracking";
import { AgentSidebar } from "@agent-native/toolkit/app/chat/AgentSidebar";
import { defaultChatFirstCopy } from "@agent-native/toolkit/app/chat/chat-first-copy";
import type { ChatFirstCopy } from "@agent-native/toolkit/app/chat/chat-first/types";
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconClockHour4,
} from "@tabler/icons-react";
import { useTheme } from "next-themes";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link } from "react-router";

import { isEmbedSessionExpiredMessage } from "../lib/embed-session-recovery";
import {
  requestWorkspaceAppFrameView,
  workspaceAppFramePath,
  workspaceAppFramePathAtMount,
  type WorkspaceAppFrameView,
} from "../lib/workspace-app-frame-view";
import {
  isWorkspaceAppHostPageUrl,
  isWorkspaceSsoApp,
  isDispatchWorkspaceAppId,
  navigateToWorkspaceApp,
  shouldOpenWorkspaceAppInTopWindow,
  workspaceAppRouteForChildPath,
  workspaceAppDirectHref,
  workspaceAppHref,
  workspaceAppTargetPath,
  type WorkspaceAppSummary,
} from "../lib/workspace-apps";
import {
  DISPATCH_CHILD_BROWSER_TAB_PARAM,
  isDispatchChildBrowserTabId,
} from "../shared/chat-first-pane";
import { DISPATCH_WORKSPACE_SSO_FLAG } from "../shared/feature-flags";
import { workspaceAppChatProxyPath } from "../shared/workspace-app-chat";
import { ActionQueryError } from "./action-query-error";
import { ChatFirstAppPane } from "./deferred-chat-components.js";
import { Alert, AlertDescription } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";

const EMBED_SESSION_TIMEOUT_MS = 100_000;
const MAX_FRAME_CHAT_MESSAGE_LENGTH = 20_000;
// Covers 51 bounded records after worst-case JSON escaping, plus framing.
const MAX_FRAME_CHAT_CONTEXT_LENGTH = 700_000;

interface EmbedSessionResult {
  startUrl: string;
  childBrowserTabId?: string;
}

interface EmbedSessionInput {
  app?: string;
  path?: string;
  url?: string;
  chrome: "minimal";
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

const CHAT_FIRST_EMBED_PREFETCH_TTL_MS = 30_000;
const prefetchedChatFirstEmbedSessions = new Map<
  string,
  { promise: Promise<EmbedSessionResult>; createdAt: number }
>();

function embedSessionInputKey(input: EmbedSessionInput): string {
  return JSON.stringify([
    input.app ?? "",
    input.path ?? "",
    input.url ?? "",
    input.chrome,
  ]);
}

function takePrefetchedChatFirstEmbedSession(
  input: EmbedSessionInput,
): Promise<EmbedSessionResult> | null {
  const key = embedSessionInputKey(input);
  const entry = prefetchedChatFirstEmbedSessions.get(key);
  if (!entry) return null;
  prefetchedChatFirstEmbedSessions.delete(key);
  return Date.now() - entry.createdAt <= CHAT_FIRST_EMBED_PREFETCH_TTL_MS
    ? entry.promise
    : null;
}

/**
 * Starts the embed session for an app pane that is about to open, so the frame
 * does not wait for its own mint. Skips every case where the frame would not
 * mint an ordinary embed session.
 */
export function usePrefetchChatFirstEmbedSession(): (
  app: WorkspaceAppFrameApp,
  embedPath: string,
) => void {
  const workspaceSsoEnabled = useFeatureFlag(DISPATCH_WORKSPACE_SSO_FLAG.key);
  const { mutateAsync: mintEmbedSession } = useActionMutation<
    EmbedSessionResult,
    EmbedSessionInput
  >("create_embed_session", {
    skipActionQueryInvalidation: true,
    timeoutMs: EMBED_SESSION_TIMEOUT_MS,
  });
  return useCallback(
    (app, embedPath) => {
      if (typeof window === "undefined" || !embedPath.startsWith("/")) return;
      if (isWorkspaceAppHostPageUrl(app, window.location.origin)) return;
      if (shouldOpenWorkspaceAppInTopWindow()) return;
      if (workspaceSsoEnabled && isWorkspaceSsoApp(app)) return;
      const input = buildChatFirstEmbedSessionInput(app.id, embedPath);
      const key = embedSessionInputKey(input);
      const existing = prefetchedChatFirstEmbedSessions.get(key);
      if (
        existing &&
        Date.now() - existing.createdAt <= CHAT_FIRST_EMBED_PREFETCH_TTL_MS
      ) {
        return;
      }
      const promise = mintEmbedSession(input);
      prefetchedChatFirstEmbedSessions.set(key, {
        promise,
        createdAt: Date.now(),
      });
      promise.catch(() => {
        if (prefetchedChatFirstEmbedSessions.get(key)?.promise === promise) {
          prefetchedChatFirstEmbedSessions.delete(key);
        }
      });
    },
    [mintEmbedSession, workspaceSsoEnabled],
  );
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
  browserTabId?: string;
}

const CHILD_TAB_POLL_MS = 500;
const CHILD_TAB_POLL_ATTEMPTS = 40;

/**
 * The tab id the app's chat requests must carry is the embedded frame's, not
 * Dispatch's: apps share one database, so a `navigate:<tabId>` command written
 * under Dispatch's own id is consumed by Dispatch's navigation state. Until the
 * frame has adopted its claim the rail gets an id nobody consumes.
 */
export function useWorkspaceAppChildBrowserTab(): {
  browserTabId: string;
  onViewReaderChange: (read: WorkspaceAppViewReader) => () => void;
} {
  const [unclaimedId] = useState(() => crypto.randomUUID());
  const [claimedId, setClaimedId] = useState<string | null>(null);
  const onViewReaderChange = useCallback((read: WorkspaceAppViewReader) => {
    let attempts = 0;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const retry = () => {
      if (!stopped && attempts < CHILD_TAB_POLL_ATTEMPTS) {
        timer = setTimeout(poll, CHILD_TAB_POLL_MS);
      }
    };
    const poll = () => {
      attempts += 1;
      read(AbortSignal.timeout(CHILD_TAB_POLL_MS * 4))
        .then((view) => {
          if (stopped) return;
          if (view?.childBrowserTabId) setClaimedId(view.childBrowserTabId);
          else retry();
        })
        // coercion-ok: an unreadable frame stays unclaimed and the rail keeps its inert id.
        .catch(retry);
    };
    poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
      setClaimedId(null);
    };
  }, []);
  return { browserTabId: claimedId ?? unclaimedId, onViewReaderChange };
}

export function WorkspaceAppChatRail({
  appId,
  appName,
  children,
  copy = defaultChatFirstCopy,
  agentPageHref,
  onFullscreenRequest,
  browserTabId,
}: WorkspaceAppChatRailProps) {
  const t = useT();
  const appChat = useWorkspaceAppChatApi(appId);
  const retryRef = useRef<HTMLButtonElement>(null);

  // The embedded app's chat button hands its toggle to Dispatch; with no sidebar mounted it would otherwise do nothing.
  useEffect(() => {
    if (!appChat.unavailable) return;
    const focusRetry = () => retryRef.current?.focus();
    window.addEventListener("agent-panel:toggle", focusRetry);
    window.addEventListener("agent-panel:open", focusRetry);
    return () => {
      window.removeEventListener("agent-panel:toggle", focusRetry);
      window.removeEventListener("agent-panel:open", focusRetry);
    };
  }, [appChat.unavailable]);

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
                ref={retryRef}
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
      isolateHistoryByScope
      apiUrl={appChat.apiUrl}
      agentChatSurface="app"
      {...(browserTabId ? { browserTabId } : {})}
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

function navigateSameOriginWorkspaceApp(
  frame: Window,
  mountPath: string | null | undefined,
  url: URL,
): boolean {
  const base = mountPath?.replace(/\/+$/, "");
  if (!base || url.origin !== window.location.origin) return false;
  try {
    const current = new URL(frame.location.href);
    if (
      current.origin !== url.origin ||
      (current.pathname !== base && !current.pathname.startsWith(`${base}/`))
    ) {
      return false;
    }
    const nextPath = workspaceAppFramePath(url);
    if (workspaceAppFramePath(current) === nextPath) return true;
    const index = frame.history.state?.idx;
    const state = {
      usr: null,
      key: crypto.randomUUID(),
      idx: typeof index === "number" ? index + 1 : 0,
    };
    frame.history.pushState(state, "", nextPath);
    const FramePopStateEvent = (frame as Window & typeof globalThis)
      .PopStateEvent;
    frame.dispatchEvent(new FramePopStateEvent("popstate", { state }));
    return true;
  } catch {
    // coercion-ok: a redirected iframe rejects direct access and falls back to the guest bridge.
    return false;
  }
}

function readSameOriginWorkspaceAppView(
  frame: Window,
  mount: URL,
): (WorkspaceAppFrameView & { pendingTabClaim: boolean }) | null {
  try {
    const location = new URL(frame.location.href);
    const path = workspaceAppFramePathAtMount(location, mount);
    if (!path) return null;
    const selectedText = frame.getSelection()?.toString().trim();
    return {
      path,
      title: frame.document.title,
      ...(selectedText ? { selectedText } : {}),
      pendingTabClaim: location.searchParams.has(
        DISPATCH_CHILD_BROWSER_TAB_PARAM,
      ),
    };
  } catch {
    // coercion-ok: null means the frame view is unavailable after the browser denies access.
    return null;
  }
}

export interface WorkspaceAppFrameApp {
  id: string;
  name: string;
  path?: string | null;
  homePath?: string | null;
  url?: string | null;
  isDispatch?: boolean;
}

export type WorkspaceAppViewReader = (signal: AbortSignal) => Promise<
  | (WorkspaceAppFrameView & {
      origin?: string;
      childBrowserTabId?: string;
    })
  | null
>;

interface WorkspaceAppFrameProps {
  app: WorkspaceAppFrameApp;
  navigateToTopWindow?: (href: string) => boolean | void;
  embedPath?: string;
  initialPath?: string;
  onChildRouteChange?: (path: string) => void;
  onViewReaderChange?: (read: WorkspaceAppViewReader) => () => void;
  claimBrowserTab?: boolean;
  chatSidebar?: boolean;
  copy?: ChatFirstCopy;
}

export function WorkspaceAppFrame({
  app,
  navigateToTopWindow = navigateToWorkspaceApp,
  embedPath,
  initialPath,
  onChildRouteChange,
  onViewReaderChange,
  claimBrowserTab = false,
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
  const openInTopWindow = shouldOpenWorkspaceAppInTopWindow();
  const requestedPath = embedPath ?? initialPath;
  const [launchPath, setLaunchPath] = useState(requestedPath);
  const [completedNavigation, setCompletedNavigation] = useState({
    requestedPath,
    accepted: true,
  });
  const requestedPathAccepted =
    completedNavigation.accepted &&
    completedNavigation.requestedPath === requestedPath;
  const [loadedDocument, setLoadedDocument] = useState<{ url: string } | null>(
    null,
  );
  const pendingNavigation = useRef<{
    controller: AbortController;
    path: string;
    requestedPath: string | undefined;
  } | null>(null);
  const observedPath = useRef<string | null>(null);
  const framePath = openInTopWindow ? requestedPath : launchPath;
  const childBrowserTabClaim = useRef<{ startUrl: string; id: string } | null>(
    null,
  );
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
    embedFrameRef.current?.contentWindow?.postMessage(
      { type: "agentNative.frameOrigin", origin: window.location.origin },
      "*",
    );
    postThemeToFrame();
    pendingNavigation.current?.controller.abort();
    pendingNavigation.current = null;
    observedPath.current = null;
    setLoadedDocument(embedUrl ? { url: embedUrl } : null);
    if (isDirectFallback) setEmbedError(null);
  }, [embedUrl, isDirectFallback, postThemeToFrame]);
  const workspaceSsoEnabled = useFeatureFlag(DISPATCH_WORKSPACE_SSO_FLAG.key);
  const useWorkspaceSso = workspaceSsoEnabled && isWorkspaceSsoApp(app);
  const createEmbedSession = useActionMutation<
    EmbedSessionResult,
    EmbedSessionInput
  >("create_embed_session", {
    skipActionQueryInvalidation: true,
    timeoutMs: EMBED_SESSION_TIMEOUT_MS,
  });
  const createWorkspaceSsoEmbedSession = useActionMutation<
    EmbedSessionResult,
    EmbedSessionInput
  >("create-workspace-app-embed-session", {
    skipActionQueryInvalidation: true,
    timeoutMs: EMBED_SESSION_TIMEOUT_MS,
  });
  const isHostPageUrl = isWorkspaceAppHostPageUrl(
    app,
    typeof window === "undefined" ? undefined : window.location.origin,
  );
  const appUrl = isHostPageUrl ? null : (app.url ?? null);
  const appHref = workspaceAppHref({
    id: app.id,
    name: app.name,
    path: app.path ?? "",
    homePath: app.homePath ?? undefined,
    url: appUrl,
    isDispatch: app.isDispatch ?? isDispatchWorkspaceAppId(app.id),
  });
  const topWindowHref = useMemo(
    () =>
      requestedPath === undefined
        ? appHref
        : workspaceAppDirectHref(
            { path: app.path ?? null, url: appUrl },
            requestedPath,
          ),
    [app.path, appHref, appUrl, requestedPath],
  );
  const topWindowSsoAttemptKey = JSON.stringify([
    app.id,
    app.path,
    app.url,
    framePath,
    embedAttempt,
  ]);
  const topWindowSsoAttemptedRef = useRef<string | null>(null);
  // A same-origin workspace app already shares the workspace session cookie, so
  // framing it through an embed session makes it worse: an ordinary embed
  // session is limited to its document and static assets (embed-session.ts
  // embedSessionAllowsRequest, pinned by "limits ordinary scope ... to its
  // document and static runtime requests"), which leaves the framed app unable
  // to call any of its own actions. Measured on a hosted workspace: framed with
  // the token the app answered none of 16 action calls with 200 and rendered its
  // failure copy; framed directly it answered all 16.
  // Keep the embedded presentation without the credential.
  const hostPageDirectUrl = useMemo(() => {
    if (!isHostPageUrl) return null;
    const targetPath = framePath;
    const href =
      targetPath !== undefined
        ? workspaceAppDirectHref(
            { path: app.path ?? null, url: appUrl },
            targetPath,
          )
        : appHref;
    // No embed parameters: without a token \`embedded=1\` only changes
    // batching, and the plain app URL is what the existing direct fallback
    // already loads when a mint fails.
    return href || null;
  }, [app.path, appHref, appUrl, framePath, isHostPageUrl]);

  const embedInput = useMemo<EmbedSessionInput | null>(() => {
    if (framePath !== undefined) {
      return buildChatFirstEmbedSessionInput(app.id, framePath);
    }
    if (!appHref) return null;
    if (isHostPageUrl) {
      return buildChatFirstEmbedSessionInput(
        app.id,
        workspaceAppTargetPath({ homePath: app.homePath ?? null }),
      );
    }
    return {
      app: app.id,
      ...(appUrl?.trim() ? { url: appHref } : { path: appHref }),
      chrome: "minimal",
    };
  }, [app.homePath, app.id, appHref, appUrl, framePath, isHostPageUrl]);

  useEffect(() => {
    if (hostPageDirectUrl) return;
    if (openInTopWindow && useWorkspaceSso && embedInput) {
      setTopWindowNavigationFailed(false);
      return;
    }
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
  }, [
    embedInput,
    navigateToTopWindow,
    openInTopWindow,
    topWindowHref,
    useWorkspaceSso,
  ]);

  useEffect(() => {
    setLoadedDocument(null);
    observedPath.current = null;
    childBrowserTabClaim.current = null;
    if (hostPageDirectUrl) {
      if (claimBrowserTab) {
        const url = new URL(hostPageDirectUrl, window.location.href);
        const id = crypto.randomUUID();
        url.searchParams.set(DISPATCH_CHILD_BROWSER_TAB_PARAM, id);
        childBrowserTabClaim.current = { startUrl: url.href, id };
        setEmbedUrl(url.href);
      } else {
        setEmbedUrl(hostPageDirectUrl);
      }
      setEmbedError(null);
      setIsDirectFallback(false);
      return;
    }
    const useTopWindowSso = openInTopWindow && useWorkspaceSso && !!embedInput;
    if (
      !embedInput ||
      (openInTopWindow && !useWorkspaceSso && !topWindowNavigationFailed)
    ) {
      return;
    }
    if (
      useTopWindowSso &&
      topWindowSsoAttemptedRef.current === topWindowSsoAttemptKey
    ) {
      return;
    }
    if (useTopWindowSso) {
      topWindowSsoAttemptedRef.current = topWindowSsoAttemptKey;
    }
    let cancelled = false;
    setEmbedUrl(null);
    setEmbedError(null);
    setIsDirectFallback(false);
    const createSession = useWorkspaceSso
      ? createWorkspaceSsoEmbedSession
      : createEmbedSession;
    const prefetched = useWorkspaceSso
      ? null
      : takePrefetchedChatFirstEmbedSession(embedInput);
    void (prefetched ?? createSession.mutateAsync(embedInput))
      .then((result) => {
        if (cancelled) return;
        if (useTopWindowSso) {
          let didNavigate = false;
          try {
            didNavigate = navigateToTopWindow(result.startUrl) !== false;
          } catch {
            didNavigate = false;
          }
          setTopWindowNavigationFailed(!didNavigate);
          setEmbedUrl(didNavigate ? null : result.startUrl);
          return;
        }
        if (
          claimBrowserTab &&
          isDispatchChildBrowserTabId(result.childBrowserTabId)
        ) {
          childBrowserTabClaim.current = {
            startUrl: result.startUrl,
            id: result.childBrowserTabId,
          };
        }
        setEmbedUrl(result.startUrl);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        const error = cause instanceof Error ? cause : new Error(String(cause));
        if (useWorkspaceSso) {
          setIsDirectFallback(false);
          setEmbedUrl(null);
          setEmbedError(error);
          if (useTopWindowSso) setTopWindowNavigationFailed(true);
          return;
        }
        setIsDirectFallback(true);
        const fallbackHref =
          framePath !== undefined
            ? workspaceAppDirectHref(
                { path: app.path ?? "", url: appUrl },
                framePath,
              )
            : appHref;
        setEmbedUrl(fallbackHref);
        setEmbedError(error);
      });
    return () => {
      cancelled = true;
    };
  }, [
    app.id,
    app.path,
    app.url,
    appHref,
    claimBrowserTab,
    createEmbedSession.mutateAsync,
    createWorkspaceSsoEmbedSession.mutateAsync,
    embedInput,
    framePath,
    hostPageDirectUrl,
    embedAttempt,
    openInTopWindow,
    navigateToTopWindow,
    topWindowSsoAttemptKey,
    topWindowNavigationFailed,
    useWorkspaceSso,
  ]);

  const reloadFrame = useCallback(() => {
    pendingNavigation.current?.controller.abort();
    pendingNavigation.current = null;
    setLoadedDocument(null);
    setLaunchPath(requestedPath);
    setCompletedNavigation({ requestedPath, accepted: true });
    setEmbedAttempt((attempt) => attempt + 1);
  }, [requestedPath]);

  useEffect(
    () => () => {
      pendingNavigation.current?.controller.abort();
      pendingNavigation.current = null;
    },
    [embedUrl],
  );

  const finishNavigation = useEffectEvent(
    (route: string | undefined, accepted: boolean) => {
      if (!accepted && route === requestedPath) {
        reloadFrame();
        return;
      }
      setCompletedNavigation({ requestedPath: route, accepted });
    },
  );

  useEffect(() => {
    const frame = embedFrameRef.current;
    const target = frame?.contentWindow;
    if (
      openInTopWindow ||
      !embedUrl ||
      loadedDocument?.url !== embedUrl ||
      !target ||
      requestedPathAccepted ||
      pendingNavigation.current
    ) {
      return;
    }

    const href =
      requestedPath === undefined
        ? appHref
        : workspaceAppDirectHref(
            { path: app.path ?? null, url: appUrl },
            requestedPath,
          );
    if (!href) {
      finishNavigation(requestedPath, false);
      return;
    }
    const url = new URL(href, window.location.href);
    const origin = new URL(embedUrl, window.location.href).origin;
    if (url.origin !== origin) {
      finishNavigation(requestedPath, false);
      return;
    }

    const path = workspaceAppFramePath(url);
    if (observedPath.current === path) {
      finishNavigation(requestedPath, true);
      return;
    }
    if (
      hostPageDirectUrl &&
      navigateSameOriginWorkspaceApp(target, app.path, url)
    ) {
      finishNavigation(requestedPath, true);
      return;
    }

    const controller = new AbortController();
    const navigation = { controller, path, requestedPath };
    pendingNavigation.current = navigation;
    void requestWorkspaceAppFrameView(
      target,
      origin,
      { operation: "navigate", path },
      controller.signal,
    ).then((receipt) => {
      if (pendingNavigation.current !== navigation) return;
      pendingNavigation.current = null;
      if (frame !== embedFrameRef.current) return;
      const accepted = receipt?.path === navigation.path;
      if (!accepted || observedPath.current !== navigation.path) {
        observedPath.current = null;
      }
      finishNavigation(navigation.requestedPath, accepted);
    });
  }, [
    app.path,
    appHref,
    appUrl,
    completedNavigation,
    embedUrl,
    hostPageDirectUrl,
    loadedDocument,
    requestedPathAccepted,
    openInTopWindow,
    requestedPath,
  ]);

  const relayChildRoute = useEffectEvent((childPath: string, route: string) => {
    const pending = pendingNavigation.current;
    if (
      pending
        ? pending.requestedPath === requestedPath && pending.path === childPath
        : requestedPathAccepted
    ) {
      onChildRouteChange?.(route);
    }
  });

  useEffect(() => {
    const handleEmbedSessionExpired = (event: MessageEvent) => {
      if (
        !isEmbedSessionExpiredMessage(event, embedFrameRef.current, embedUrl)
      ) {
        return;
      }
      reloadFrame();
    };

    window.addEventListener("message", handleEmbedSessionExpired);
    return () =>
      window.removeEventListener("message", handleEmbedSessionExpired);
  }, [embedUrl, reloadFrame]);

  useEffect(() => {
    if (!embedUrl) return;

    const frame = embedFrameRef.current;
    if (!frame) return;

    let expectedOrigin: string;
    try {
      expectedOrigin = new URL(embedUrl, window.location.href).origin;
    } catch {
      return;
    }

    const handleWorkspaceAppRoute = (event: MessageEvent) => {
      if (
        event.source !== frame.contentWindow ||
        event.origin !== expectedOrigin
      ) {
        return;
      }
      const message = event.data as {
        type?: unknown;
        path?: unknown;
      } | null;
      if (
        message?.type !== AGENT_NATIVE_WORKSPACE_APP_ROUTE_MESSAGE_TYPE ||
        typeof message.path !== "string" ||
        !message.path.startsWith("/") ||
        message.path.startsWith("//") ||
        /[\u0000-\u001f\u007f]/.test(message.path)
      ) {
        return;
      }

      const childUrl = new URL(message.path, expectedOrigin);
      if (childUrl.origin !== expectedOrigin) return;
      const childPath = workspaceAppFramePath(childUrl);
      const route = workspaceAppRouteForChildPath(
        { id: app.id, path: app.path ?? "", url: appUrl },
        childPath,
      );
      if (!route) return;
      observedPath.current = childPath;
      relayChildRoute(childPath, route);
    };

    window.addEventListener("message", handleWorkspaceAppRoute);
    return () => window.removeEventListener("message", handleWorkspaceAppRoute);
  }, [app.id, app.path, appUrl, embedUrl]);

  useEffect(() => {
    if (!onViewReaderChange || !embedUrl || loadedDocument?.url !== embedUrl) {
      return;
    }
    const frame = embedFrameRef.current;
    const target = frame?.contentWindow;
    const mountHref = workspaceAppDirectHref(
      { path: app.path ?? null, url: appUrl },
      "/",
    );
    if (!target || !mountHref) return;

    const origin = new URL(embedUrl, window.location.href).origin;
    const mount = new URL(mountHref, window.location.href);
    if (mount.origin !== origin) return;

    let current = true;
    const canRead = (signal: AbortSignal) =>
      current &&
      !signal.aborted &&
      frame === embedFrameRef.current &&
      !pendingNavigation.current;
    const unregister = onViewReaderChange(async (signal) => {
      if (!canRead(signal)) return null;
      const read =
        origin === window.location.origin
          ? readSameOriginWorkspaceAppView(target, mount)
          : await requestWorkspaceAppFrameView(
              target,
              origin,
              { operation: "read" },
              signal,
            );
      if (!read || !canRead(signal)) return null;
      if (/[\u0000-\u001f\u007f]/.test(read.path)) return null;
      const renderedUrl = new URL(read.path, origin);
      const path = workspaceAppFramePathAtMount(renderedUrl, mount);
      const claim = childBrowserTabClaim.current;
      if (
        !path ||
        path.length > 2_000 ||
        (observedPath.current && observedPath.current !== path)
      ) {
        return null;
      }
      return {
        path,
        ...(read.title === undefined
          ? {}
          : { title: read.title.slice(0, 256) }),
        ...(read.selectedText === undefined
          ? {}
          : { selectedText: read.selectedText.slice(0, 4_000) }),
        ...(claim?.startUrl === embedUrl &&
        (!("pendingTabClaim" in read) || read.pendingTabClaim === false) &&
        !renderedUrl.searchParams.has(DISPATCH_CHILD_BROWSER_TAB_PARAM)
          ? { childBrowserTabId: claim.id, origin }
          : {}),
      };
    });
    return () => {
      current = false;
      unregister();
    };
  }, [app.path, appUrl, embedUrl, loadedDocument, onViewReaderChange]);

  useEffect(() => {
    if (!embedUrl) return;

    let expectedOrigin: string;
    try {
      expectedOrigin = new URL(embedUrl, window.location.href).origin;
    } catch {
      return;
    }
    // Same-origin children are already handled by their local chat receiver.
    if (expectedOrigin === window.location.origin) return;

    const handleFrameChatSubmit = (event: MessageEvent) => {
      const source = embedFrameRef.current?.contentWindow;
      if (
        !source ||
        event.source !== source ||
        event.origin !== expectedOrigin
      ) {
        return;
      }

      const envelope = event.data as {
        type?: unknown;
        data?: unknown;
      } | null;
      if (envelope?.type !== "agentNative.submitChat") return;
      const data = envelope.data as Record<string, unknown> | null;
      if (data?.submit !== true || data.confirmParentFrame !== true) return;
      const { submitMessageId, message, context } = data;
      if (
        typeof submitMessageId !== "string" ||
        submitMessageId.length === 0 ||
        submitMessageId.length > 200
      )
        return;
      const invalidPayload =
        typeof message !== "string" ||
        message.length === 0 ||
        message.length > MAX_FRAME_CHAT_MESSAGE_LENGTH ||
        (context !== undefined &&
          (typeof context !== "string" ||
            context.length > MAX_FRAME_CHAT_CONTEXT_LENGTH));
      if (invalidPayload) {
        source.postMessage(
          {
            type: "agentNative.submitChatResult",
            data: {
              submitMessageId,
              delivered: false,
              reason: "invalid-payload",
            },
          },
          event.origin,
        );
        return;
      }

      void sendToAgentChatAndConfirm(
        {
          message,
          ...(typeof context === "string" ? { context } : {}),
          chatTarget: "local",
          openSidebar: true,
          submit: true,
        },
        { submitMessageId },
      ).then((result) => {
        if (source !== embedFrameRef.current?.contentWindow) return;
        source.postMessage(
          {
            type: "agentNative.submitChatResult",
            data: {
              submitMessageId,
              delivered: result.delivered,
              ...(result.reason ? { reason: result.reason } : {}),
            },
          },
          event.origin,
        );
      });
    };

    window.addEventListener("message", handleFrameChatSubmit);
    return () => window.removeEventListener("message", handleFrameChatSubmit);
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
      onRetry={embedInput ? reloadFrame : undefined}
      renderEmbed={({ url, title }) => (
        <iframe
          key={embedAttempt}
          data-dispatch-workspace-app-frame
          src={url}
          title={title ?? app.name}
          ref={embedFrameRef}
          onLoad={handleFrameLoad}
          referrerPolicy="no-referrer"
          allow="clipboard-read; clipboard-write; fullscreen"
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
  initialPath,
  onChildRouteChange,
  onViewReaderChange,
  claimBrowserTab,
}: {
  appId?: string;
  navigateToTopWindow?: (href: string) => boolean | void;
  initialPath?: string;
  onChildRouteChange?: (path: string) => void;
  onViewReaderChange?: (read: WorkspaceAppViewReader) => () => void;
  claimBrowserTab?: boolean;
}) {
  const t = useT();
  const workspaceAppsQuery = useActionQuery<WorkspaceAppSummary[]>(
    "list-workspace-apps",
    { includeAgentCards: false, includeArchived: true },
  );
  const apps = useMemo(
    () => (workspaceAppsQuery.data ?? []).filter((item) => !item.archived),
    [workspaceAppsQuery.data],
  );
  const app = useMemo(
    () =>
      apps.find(
        (item) => item.id.trim().toLowerCase() === appId?.trim().toLowerCase(),
      ) ?? null,
    [appId, apps],
  );
  const isLoading = workspaceAppsQuery.isLoading;
  const queryError = workspaceAppsQuery.isError
    ? workspaceAppsQuery.error
    : null;

  if (queryError && !app) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center p-6">
        <div className="w-full max-w-2xl">
          <ActionQueryError
            error={queryError}
            onRetry={() => void workspaceAppsQuery.refetch()}
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
          key={app.id}
          app={app}
          navigateToTopWindow={navigateToTopWindow}
          initialPath={initialPath}
          onChildRouteChange={onChildRouteChange}
          onViewReaderChange={onViewReaderChange}
          claimBrowserTab={claimBrowserTab}
        />
      </div>
    </div>
  );
}

const MAX_KEEP_ALIVE_APPS = 3;

export function useWarmWorkspaceAppIds(
  scope: string,
  activeQualifiedAppId: string | null,
  availableQualifiedAppIds?: readonly string[],
): readonly string[] {
  const [pool, setPool] = useState<{ scope: string; ids: readonly string[] }>(
    () => ({ scope, ids: [] }),
  );
  const retained = pool.scope === scope ? pool.ids : [];
  const available = availableQualifiedAppIds
    ? retained.filter((id) => availableQualifiedAppIds.includes(id))
    : retained;
  const next = activeQualifiedAppId
    ? [
        activeQualifiedAppId,
        ...available.filter((id) => id !== activeQualifiedAppId),
      ].slice(0, MAX_KEEP_ALIVE_APPS)
    : available;

  if (
    pool.scope === scope &&
    next.length === pool.ids.length &&
    next.every((id, index) => id === pool.ids[index])
  ) {
    return pool.ids;
  }
  setPool({ scope, ids: next });
  return next;
}

export function WorkspaceAppKeepAlive({
  activeAppId,
  initialPath,
  onChildRouteChange,
  onViewReaderChange,
  claimBrowserTab,
}: {
  activeAppId: string | null;
  /**
   * The deep route for the app being shown. Without it every kept-alive pane
   * opens the app's home: this wrapper is what Layout renders for an app route,
   * so the route's own deep path has to reach the host through here.
   */
  initialPath?: string;
  onChildRouteChange?: (path: string) => void;
  onViewReaderChange?: (read: WorkspaceAppViewReader) => () => void;
  claimBrowserTab?: boolean;
}) {
  const warmAppIds = useWarmWorkspaceAppIds("standalone", activeAppId);
  const renderedAppIds = useMemo(() => [...warmAppIds].sort(), [warmAppIds]);
  const [pathByAppId, setPathByAppId] = useState<
    Record<string, string | undefined>
  >({});

  useEffect(() => {
    if (!activeAppId) return;
    setPathByAppId((current) =>
      Object.fromEntries(
        warmAppIds.map((id) => [
          id,
          id === activeAppId ? initialPath : current[id],
        ]),
      ),
    );
  }, [activeAppId, initialPath, warmAppIds]);

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
            <WorkspaceAppHost
              appId={appId}
              initialPath={active ? initialPath : pathByAppId[appId]}
              {...(active && onChildRouteChange ? { onChildRouteChange } : {})}
              {...(active && onViewReaderChange ? { onViewReaderChange } : {})}
              {...(active && claimBrowserTab ? { claimBrowserTab } : {})}
            />
          </div>
        );
      })}
    </div>
  );
}
