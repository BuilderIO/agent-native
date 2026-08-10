import {
  CHAT_FIRST_MODE_CHANGED_EVENT,
  AgentChatSurface,
  chatFirstSurfaceTabId,
  AgentSidebar,
  ChatFirstSurfacePanelToggle,
  closeChatFirstSessionWatch,
  emitChatFirstSessionWatch,
  getChatFirstSurfaceTabsStore,
  focusAgentChat,
  navigateWithAgentChatViewTransition,
  readChatFirstAppLayout,
  readChatFirstMode,
  resolveChatFirstBrowserTarget,
  resolveChatFirstAppTarget,
  subscribeChatFirstOpenBrowser,
  subscribeChatFirstOpenApp,
  writeChatFirstAppLayout,
  useChatFirstSessionWatch,
  useChatFirstSurfacePanel,
  useChatFirstSurfaceResize,
  useChatFirstSurfaceTabs,
  type ChatFirstAppRegistration,
  type ChatFirstAppLayoutPreference,
  type ChatFirstAppResolution,
  type ChatFirstOpenBrowserDetail,
  type ChatFirstOpenAppDetail,
  type ChatFirstSessionReference,
  type ChatFirstSurfaceTab,
  type ChatFirstSurfaceKind,
  useAgentChatHomeHandoff,
  useAgentChatHomeHandoffLinks,
  useChatThreads,
  type ChatThreadSummary,
} from "@agent-native/core/client/agent-chat";
import { appBasePath, appPath } from "@agent-native/core/client/api-path";
import {
  readClientAppState,
  writeClientAppState,
} from "@agent-native/core/client/application-state";
import {
  ChatFirstAgentsPane,
  ChatFirstAppPane,
  ChatFirstAppsRail,
  ChatFirstBrowserPane,
  ChatFirstChatHistory,
  ChatFirstPrimaryNavigation,
  ChatFirstSessionWatchPane,
  ChatFirstSurfacePanel,
  ChatFirstSurfaceContent,
  ChatFirstSurfaceTabs,
  defaultChatFirstCopy,
  type ChatFirstAgentActivity,
  type ChatFirstAppItem,
  type ChatFirstCopy,
  type ChatFirstEmbedTarget,
} from "@agent-native/core/client/chat-first";
import { writeClipboardText } from "@agent-native/core/client/clipboard";
import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { openCommandMenu } from "@agent-native/core/client/navigation";
import { InvitationBanner, OrgSwitcher } from "@agent-native/core/client/org";
import { FeedbackButton } from "@agent-native/core/client/ui";
import { SidebarFooterActions } from "@agent-native/toolkit/app-shell";
import {
  ChatHistoryRail,
  type ChatHistoryItem,
} from "@agent-native/toolkit/chat-history";
import {
  IconApps,
  IconBrandSlack,
  IconBrandTelegram,
  IconCopy,
  IconEye,
  IconMessageQuestion,
  IconBroadcast,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconSettings,
  IconShield,
  IconSearch,
  IconWorld,
  IconDeviceDesktop,
  IconPlus,
} from "@tabler/icons-react";
import {
  createContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useContext,
  useCallback,
  type ComponentType,
  type ReactNode,
} from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { toast } from "sonner";

import { cn } from "../../lib/utils";
import {
  mergeChatFirstWorkspaceApps,
  type WorkspaceAppSummary,
} from "../../lib/workspace-apps";
import { AppIcon } from "../app-icon";
import { CreateAppPopover } from "../create-app-popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "../ui/sheet";
import { Skeleton } from "../ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { Header } from "./Header";
import { HeaderActionsProvider } from "./HeaderActions";

export type DispatchNavSection = "primary" | "operations";

export type DispatchNavIcon = ComponentType<{
  size?: number | string;
  className?: string;
}>;

export interface DispatchNavItem {
  /** Stable id used for keys and navigation.view. Avoid built-in ids. */
  id: string;
  /** React Router path for the tab, usually backed by an app/routes/*.tsx file. */
  to: string;
  label: string;
  icon?: DispatchNavIcon;
  /** Defaults to "operations", which renders under the Admin control plane. */
  section?: DispatchNavSection;
  /** Override active matching for nested or multi-route tools. */
  match?: (pathname: string) => boolean;
  /** Canonical path inside the Admin shell for management tabs. */
  adminTo?: string;
}

export interface DispatchExtensionConfig {
  /** Opt into the Codex/T3-like chat-first shell for chat routes. */
  chatFirst?: boolean;
  /** Extra sidebar tabs supplied by the generated workspace. */
  navItems?: readonly DispatchNavItem[];
  /** Extra React Query keys to invalidate when Dispatch receives DB sync events. */
  queryKeys?: readonly string[];
}

const PRIMARY_NAV_ITEMS = [
  {
    id: "overview",
    to: "/overview",
    label: "Overview",
    icon: IconBroadcast,
    section: "primary",
  },
  {
    id: "chat",
    to: "/chat",
    label: "Chat",
    icon: IconMessageQuestion,
    section: "primary",
  },
  {
    id: "apps",
    to: "/apps",
    label: "Apps",
    icon: IconApps,
    section: "primary",
  },
] as const satisfies readonly DispatchNavItem[];

const BOTTOM_NAV_ITEMS = [
  {
    id: "admin",
    to: "/admin",
    label: "Admin",
    icon: IconShield,
  },
  {
    id: "settings",
    to: "/settings",
    label: "Settings",
    icon: IconSettings,
  },
] as const satisfies readonly DispatchNavItem[];

const EMPTY_NAV_ITEMS: readonly DispatchNavItem[] = [];
const DISPATCH_SIDEBAR_LABEL = "Dispatch";

const CHROMELESS_PATHS = ["/approval", "/browser-chat", "/browser-connect"];
const SIDEBAR_COLLAPSE_KEY = "dispatch.sidebar.collapsed";
const CHAT_HISTORY_SOURCE_KEY = "dispatch.chat-history.source";
const CHAT_FIRST_PANE_STATE_KEY = "chat-first-pane";

interface DispatchChatFirstPane {
  appId: string;
  path?: string;
  view?: string;
}

interface ChatFirstEmbedSessionResult {
  startUrl: string;
}

interface ChatFirstEmbedSessionInput {
  app?: string;
  path?: string;
  url?: string;
  chrome: "minimal";
}

export function buildChatFirstEmbedSessionInput(
  appId: string,
  path: string,
): ChatFirstEmbedSessionInput {
  return { app: appId, path, chrome: "minimal" };
}

interface DispatchAgentThreadSummary {
  id: string;
  title: string;
  preview?: string;
  snippet?: string;
  updatedAt?: number;
}

interface SearchAgentThreadsResult {
  threads: DispatchAgentThreadSummary[];
}

const DispatchExtensionsContext = createContext<
  DispatchExtensionConfig | undefined
>(undefined);

export function useDispatchExtensions(): DispatchExtensionConfig | undefined {
  return useContext(DispatchExtensionsContext);
}

// Routes whose page renders its own toolbar.
// Layout still mounts the sidebar + AgentSidebar, but skips its own Header so
// there's no double-header.
function pageOwnsToolbar(pathname: string): boolean {
  if (pathname === "/tools" || pathname.startsWith("/tools/")) return true;
  if (pathname === "/extensions" || pathname.startsWith("/extensions/"))
    return true;
  if (pathname.startsWith("/apps/")) return true;
  return false;
}

function sectionFor(item: DispatchNavItem): DispatchNavSection {
  return item.section ?? "operations";
}

function navItemMatchesPath(item: DispatchNavItem, pathname: string): boolean {
  if (item.match) {
    try {
      if (item.match(pathname)) return true;
    } catch {
      return false;
    }
  }
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}

function navItemsForSection(
  items: readonly DispatchNavItem[],
  section: DispatchNavSection,
): DispatchNavItem[] {
  return items.filter((item) => sectionFor(item) === section);
}

function localDispatchPath(pathname: string): string {
  const basePath = appBasePath();
  if (!basePath) return pathname;
  if (pathname === basePath) return "/";
  if (pathname.startsWith(`${basePath}/`)) {
    return pathname.slice(basePath.length) || "/";
  }
  return pathname;
}

function dispatchNavLinkTarget(path: string): string {
  if (typeof window === "undefined") return path;
  const basePath = appBasePath();
  if (!basePath) return path;
  // Mirror the basename calculation entry.client.tsx uses to configure the
  // router (basePath iff the current URL is under that mount, "" otherwise).
  // Reading the live URL directly avoids races with the previous check on
  // `__reactRouterContext.basename`, which could read undefined before the
  // entry script set it — that race produced /dispatch/dispatch/<route>
  // history entries that 404'd on back-button navigation.
  const pathname = window.location.pathname;
  const routerHasBasename =
    pathname === basePath || pathname.startsWith(`${basePath}/`);
  return routerHasBasename ? path : appPath(path);
}

function chatFirstResolutionMessage(
  reason: Exclude<ChatFirstAppResolution, { status: "ready" }>["reason"],
): string {
  switch (reason) {
    case "empty-detail":
      return "The agent did not provide an app target to open.";
    case "invalid-url":
      return "The requested app route was not registered for this workspace app.";
    case "unknown-app":
      return "That app is not available in this workspace.";
  }
  return "The requested app could not be opened.";
}

function chatFirstBrowserResolutionMessage(
  reason: "empty-detail" | "invalid-url",
): string {
  return reason === "empty-detail"
    ? "The agent did not provide a browser URL to open."
    : "The requested browser URL is not a safe HTTP(S) address.";
}

const DISPATCH_CHAT_FIRST_COPY_KEYS: Record<string, string> = {
  workspaceApps: "chatFirstWorkspaceApps",
  createWorkspaceApp: "chatFirstCreateWorkspaceApp",
  openApp: "chatFirstOpenApp",
  appsLoadError: "chatFirstAppsLoadError",
  noWorkspaceApps: "chatFirstNoWorkspaceApps",
  createApp: "chatFirstCreateApp",
  retry: "chatFirstRetry",
  dismiss: "chatFirstDismiss",
  unpinApp: "chatFirstUnpinApp",
  pinApp: "chatFirstPinApp",
  removePinned: "chatFirstRemovePinned",
  pinTop: "chatFirstPinTop",
  openSideSurfaces: "chatFirstOpenSideSurfaces",
  closeTab: "chatFirstCloseTab",
  close: "chatFirstClose",
  closeOthers: "chatFirstCloseOthers",
  closeToRight: "chatFirstCloseToRight",
  closeAll: "chatFirstCloseAll",
  unavailable: "chatFirstUnavailable",
  openActivity: "chatFirstOpenActivity",
  deferred: "chatFirstDeferred",
  browserBack: "chatFirstBrowserBack",
  browserForward: "chatFirstBrowserForward",
  browserReload: "chatFirstBrowserReload",
  browserAddress: "chatFirstBrowserAddress",
  browserOpenExternal: "chatFirstBrowserOpenExternal",
  browserClose: "chatFirstBrowserClose",
  browserPage: "chatFirstBrowserPage",
  browserInvalidUrl: "chatFirstBrowserInvalidUrl",
  browserPreviewStarting: "chatFirstBrowserPreviewStarting",
  browserPreviewError: "chatFirstBrowserPreviewError",
  appUnavailable: "chatFirstAppUnavailable",
  appLoading: "chatFirstLoadingApp",
  agentActivityEyebrow: "chatFirstAgentActivityEyebrow",
  agentActivityTitle: "chatFirstAgentActivityTitle",
  agentActivityDescription: "chatFirstAgentActivityDescription",
  refreshAgentActivity: "chatFirstRefreshAgentActivity",
  noAgentSessions: "chatFirstNoAgentSessions",
  startAgentSession: "chatFirstStartAgentSession",
  watchSession: "chatFirstWatchSession",
  copySessionId: "chatFirstCopySessionId",
  copySessionIdFor: "chatFirstCopySessionIdFor",
  sessionIdCopied: "chatFirstSessionIdCopied",
  sessionIdShort: "chatFirstSessionIdShort",
  copied: "chatFirstCopied",
  agentActivityStatusQueued: "chatFirstAgentActivityStatusQueued",
  agentActivityStatusRunning: "chatFirstAgentActivityStatusRunning",
  agentActivityStatusPaused: "chatFirstAgentActivityStatusPaused",
  agentActivityStatusNeedsApproval: "chatFirstAgentActivityStatusNeedsApproval",
  agentActivityStatusCompleted: "chatFirstAgentActivityStatusCompleted",
  agentActivityStatusErrored: "chatFirstAgentActivityStatusErrored",
  agentActivityStatusRecent: "chatFirstAgentActivityStatusRecent",
  agentActivityStatusUnknown: "chatFirstAgentActivityStatusUnknown",
  watchingSession: "chatFirstWatchingSession",
  session: "chatFirstSession",
  stopWatchingSession: "chatFirstStopWatchingSession",
  stopWatching: "chatFirstStopWatching",
  watchedSession: "chatFirstWatchedSession",
  agentsTitle: "chatFirstAgentsTitle",
};

const DISPATCH_CHAT_FIRST_SURFACE_COPY_KEYS: Record<
  string,
  { label: string; reason: string }
> = {
  browser: {
    label: "chatFirstSurfaceBrowserLabel",
    reason: "chatFirstSurfaceBrowserReason",
  },
  terminal: {
    label: "chatFirstSurfaceTerminalLabel",
    reason: "chatFirstSurfaceTerminalReason",
  },
  files: {
    label: "chatFirstSurfaceFilesLabel",
    reason: "chatFirstSurfaceFilesReason",
  },
  diff: {
    label: "chatFirstSurfaceDiffLabel",
    reason: "chatFirstSurfaceDiffReason",
  },
  "side-chat": {
    label: "chatFirstSurfaceSideChatLabel",
    reason: "chatFirstSurfaceSideChatReason",
  },
  agents: {
    label: "chatFirstSurfaceAgentsLabel",
    reason: "chatFirstSurfaceAgentsReason",
  },
};

function createDispatchChatFirstCopy(
  t: (key: string, options?: Record<string, unknown>) => string,
): ChatFirstCopy {
  return (key, values) => {
    if (key.startsWith("surface.")) {
      const [, kind, field] = key.split(".");
      const surface = DISPATCH_CHAT_FIRST_SURFACE_COPY_KEYS[kind];
      const translationKey =
        surface && (field === "label" || field === "reason")
          ? surface[field]
          : undefined;
      if (translationKey) {
        return t(`dispatch.pages.${translationKey}`, {
          ...(values ?? {}),
          defaultValue: defaultChatFirstCopy(key, values),
        });
      }
    }
    const translationKey = DISPATCH_CHAT_FIRST_COPY_KEYS[key];
    if (!translationKey) return defaultChatFirstCopy(key, values);
    return t(`dispatch.pages.${translationKey}`, {
      ...(values ?? {}),
      defaultValue: defaultChatFirstCopy(key, values),
    });
  };
}

function chatThreadPath(threadId: string | null): string {
  return threadId ? `/chat/${encodeURIComponent(threadId)}` : "/chat";
}

function persistedChatFirstPane(value: unknown): DispatchChatFirstPane | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.appId !== "string" || !record.appId.trim()) return null;
  return {
    appId: record.appId,
    ...(typeof record.path === "string" ? { path: record.path } : {}),
    ...(typeof record.view === "string" ? { view: record.view } : {}),
  };
}

function threadIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/chat\/([^/]+)/);
  if (!match) return null;
  try {
    const value = decodeURIComponent(match[1]).trim();
    return value || null;
  } catch {
    return null;
  }
}

export function formatThreadAge(updatedAt: number, now = Date.now()) {
  const diffMs = Math.max(0, now - updatedAt);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 7)}w`;
  return `${Math.floor(days / 365)}y`;
}

function threadTitle(thread: ChatThreadSummary, fallback: string) {
  return thread.title || thread.preview || fallback;
}

function readChatHistoryIncludesExternal(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(CHAT_HISTORY_SOURCE_KEY) === "all";
  } catch {
    // coercion-ok: localStorage is optional browser persistence.
    return false;
  }
}

function threadSourceIcon(platform: string | undefined): ReactNode {
  const normalized = platform?.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "slack") {
    return <IconBrandSlack size={13} aria-hidden="true" />;
  }
  if (normalized === "telegram") {
    return <IconBrandTelegram size={13} aria-hidden="true" />;
  }
  return <IconWorld size={13} aria-hidden="true" />;
}

function threadUpdatedAt(thread: ChatThreadSummary) {
  return Number.isFinite(thread.updatedAt)
    ? thread.updatedAt
    : Number.isFinite(thread.createdAt)
      ? thread.createdAt
      : 0;
}

function DispatchChatsSection({
  onNavigate,
  showNewChat = false,
  prelude,
  chatFirstMode = false,
  chatFirstEmbedded = false,
  chatFirstNavigation,
}: {
  onNavigate?: () => void;
  showNewChat?: boolean;
  prelude?: ReactNode;
  chatFirstMode?: boolean;
  chatFirstEmbedded?: boolean;
  chatFirstNavigation?: {
    onOpenIntegrations: () => void;
    onOpenScheduled: () => void;
  };
}) {
  const t = useT();
  const chatFirstCopy = useMemo(() => createDispatchChatFirstCopy(t), [t]);
  const navigate = useNavigate();
  const location = useLocation();
  const [includeExternal, setIncludeExternal] = useState(false);
  const [historyPreferenceReady, setHistoryPreferenceReady] = useState(false);
  const historyModeRef = useRef(includeExternal);
  const {
    threads,
    activeThreadId,
    isLoading: chatsLoading,
    createThread,
    switchThread,
    renameThread,
    refreshThreads,
  } = useChatThreads(undefined, "dispatch", undefined, {
    autoCreate: false,
    includeExternal,
  });

  const visibleThreads = useMemo(
    () =>
      threads
        .filter(
          (thread) => thread.messageCount > 0 || thread.id === activeThreadId,
        )
        .sort((a, b) => threadUpdatedAt(b) - threadUpdatedAt(a))
        .slice(0, 15),
    [activeThreadId, threads],
  );
  const localPathname = localDispatchPath(location.pathname);
  const displayedActiveThreadId =
    threadIdFromPath(localPathname) ??
    (localPathname === "/chat" ? null : activeThreadId);
  const chatItems: ChatHistoryItem[] = visibleThreads.map((thread) => {
    const title = threadTitle(thread, t("dispatch.sidebar.newChat"));
    const sourceIcon = threadSourceIcon(thread.source?.platform);
    const sourceLabel = thread.source?.platform
      ? thread.source.platform[0].toUpperCase() +
        thread.source.platform.slice(1)
      : null;
    return {
      id: thread.id,
      title: (
        <span
          className="flex min-w-0 items-center gap-1"
          title={sourceLabel ? `${sourceLabel}: ${title}` : title}
        >
          {sourceIcon ? (
            <span
              className="shrink-0 text-sidebar-foreground/55"
              aria-label={sourceLabel ?? "Connected source"}
            >
              {sourceIcon}
            </span>
          ) : null}
          <span className="truncate">{title}</span>
        </span>
      ),
      titleText: title,
      timestamp:
        thread.id === displayedActiveThreadId
          ? ""
          : formatThreadAge(threadUpdatedAt(thread)),
    };
  });

  useEffect(() => {
    setIncludeExternal(readChatHistoryIncludesExternal());
    setHistoryPreferenceReady(true);
  }, []);

  useEffect(() => {
    if (!historyPreferenceReady) return;
    try {
      localStorage.setItem(
        CHAT_HISTORY_SOURCE_KEY,
        includeExternal ? "all" : "local",
      );
    } catch {} // coercion-ok: localStorage is optional browser persistence.
    if (historyModeRef.current !== includeExternal) {
      historyModeRef.current = includeExternal;
      refreshThreads();
    }
  }, [historyPreferenceReady, includeExternal, refreshThreads]);

  useEffect(() => {
    const refresh = () => refreshThreads();
    const handleRunning = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { isRunning?: unknown }
        | undefined;
      if (detail?.isRunning === false) refreshThreads();
    };

    window.addEventListener("agent-chat:threads-updated", refresh);
    window.addEventListener("agentNative.chatRunning", handleRunning);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("agent-chat:threads-updated", refresh);
      window.removeEventListener("agentNative.chatRunning", handleRunning);
      window.removeEventListener("focus", refresh);
    };
  }, [refreshThreads]);

  function openThread(threadId: string, options?: { isNew?: boolean }) {
    switchThread(threadId);
    navigateWithAgentChatViewTransition(
      navigate,
      dispatchNavLinkTarget(
        options?.isNew ? "/chat" : chatThreadPath(threadId),
      ),
    );
    onNavigate?.();
    window.requestAnimationFrame(() => {
      window.dispatchEvent(
        new CustomEvent("agent-chat:open-thread", {
          detail: { threadId, newThread: options?.isNew === true },
        }),
      );
    });
  }

  async function handleNewChat() {
    const threadId = await createThread();
    if (threadId) openThread(threadId, { isNew: true });
  }

  return (
    <div
      className={cn(
        "ms-4 min-w-0 space-y-0.5",
        showNewChat && "dispatch-chat-first-chats",
      )}
    >
      {showNewChat && chatFirstNavigation ? (
        <nav className="space-y-0.5 px-2 py-2">
          <ChatFirstPrimaryNavigation
            copy={chatFirstCopy}
            onNewChat={() => void handleNewChat()}
            onOpenIntegrations={chatFirstNavigation.onOpenIntegrations}
            onOpenScheduled={chatFirstNavigation.onOpenScheduled}
            onSearch={openCommandMenu}
          />
        </nav>
      ) : null}
      {prelude}
      {!chatFirstMode ? (
        <div className="flex justify-end px-2 pt-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                data-dispatch-chat-source-toggle
                aria-pressed={includeExternal}
                aria-label={
                  includeExternal
                    ? t("dispatch.sidebar.showLocalChats", {
                        defaultValue: "Show local chats",
                      })
                    : t("dispatch.sidebar.showAllChats", {
                        defaultValue: "Show all chats",
                      })
                }
                onClick={() => setIncludeExternal((current) => !current)}
                className="flex size-6 items-center justify-center rounded-md text-sidebar-foreground/55 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              >
                {includeExternal ? (
                  <IconWorld size={14} aria-hidden="true" />
                ) : (
                  <IconDeviceDesktop size={14} aria-hidden="true" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {includeExternal
                ? t("dispatch.sidebar.showLocalChats", {
                    defaultValue: "Show local chats",
                  })
                : t("dispatch.sidebar.showAllChats", {
                    defaultValue: "Show all chats",
                  })}
            </TooltipContent>
          </Tooltip>
        </div>
      ) : null}
      {!chatFirstMode &&
        chatsLoading &&
        visibleThreads.length === 0 &&
        Array.from({ length: 3 }).map((_, index) => (
          <div
            key={`chat-skeleton-${index}`}
            className="flex items-center gap-2 px-3 py-1"
          >
            <Skeleton className="size-3.5 shrink-0 rounded-sm" />
            <Skeleton className="h-3 w-3/4 rounded" />
          </div>
        ))}
      {chatFirstMode ? (
        <ChatFirstChatHistory
          items={chatItems}
          activeId={displayedActiveThreadId}
          loading={chatsLoading && visibleThreads.length === 0}
          loadingLabel={
            <div className="space-y-1 px-2 py-1">
              {[0, 1, 2].map((index) => (
                <div key={index} className="flex items-center gap-2 px-1 py-1">
                  <Skeleton className="size-3.5 shrink-0 rounded-sm" />
                  <Skeleton className="h-3 w-3/4 rounded" />
                </div>
              ))}
            </div>
          }
          label={t("dispatch.sidebar.chats", { defaultValue: "Chats" })}
          onSelect={(threadId) => openThread(threadId)}
          renameMaxLength={160}
          onRename={(threadId, title) => void renameThread(threadId, title)}
          labels={{
            options: (item) =>
              t("dispatch.sidebar.chatOptions", {
                title: item.titleText ?? "",
              }),
            renameInput: (item) =>
              t("dispatch.sidebar.renameThread", {
                title: item.titleText ?? "",
              }),
            rename: t("dispatch.sidebar.renameChat"),
          }}
          renderAdditionalRowActions={(item, closeMenu) => (
            <>
              <button
                type="button"
                role="menuitem"
                className="an-chat-history-row__menu-item"
                onClick={() => {
                  closeMenu();
                  void writeClipboardText(item.id).then((copied) => {
                    toast[copied ? "success" : "error"](
                      copied
                        ? "Session ID copied"
                        : "Could not copy the session ID",
                    );
                  });
                }}
              >
                <IconCopy size={13} strokeWidth={1.8} />
                <span>Copy session ID</span>
              </button>
              {!chatFirstEmbedded ? (
                <button
                  type="button"
                  role="menuitem"
                  className="an-chat-history-row__menu-item"
                  onClick={() => {
                    closeMenu();
                    emitChatFirstSessionWatch({
                      sessionId: item.id,
                      title: item.titleText,
                      kind: "agent-chat",
                      sourceSessionId: displayedActiveThreadId ?? undefined,
                    });
                  }}
                >
                  <IconEye size={13} strokeWidth={1.8} />
                  <span>Watch and message session</span>
                </button>
              ) : null}
            </>
          )}
          className="min-w-0"
        />
      ) : (
        <ChatHistoryRail
          items={chatItems}
          activeId={displayedActiveThreadId}
          onSelect={(threadId) => openThread(threadId)}
          onNewChat={() => void handleNewChat()}
          railLabels={{
            newChat: t("dispatch.sidebar.newChat"),
            showMore: t("dispatch.sidebar.chats"),
            showLess: t("dispatch.sidebar.chats"),
          }}
          renameMaxLength={160}
          onRename={(threadId, title) => void renameThread(threadId, title)}
          labels={{
            options: (item) =>
              t("dispatch.sidebar.chatOptions", {
                title: item.titleText ?? "",
              }),
            renameInput: (item) =>
              t("dispatch.sidebar.renameThread", {
                title: item.titleText ?? "",
              }),
            rename: t("dispatch.sidebar.renameChat"),
          }}
          renderAdditionalRowActions={(item, closeMenu) => (
            <>
              <button
                type="button"
                role="menuitem"
                className="an-chat-history-row__menu-item"
                onClick={() => {
                  closeMenu();
                  void writeClipboardText(item.id).then((copied) => {
                    toast[copied ? "success" : "error"](
                      copied
                        ? "Session ID copied"
                        : "Could not copy the session ID",
                    );
                  });
                }}
              >
                <IconCopy size={13} strokeWidth={1.8} />
                <span>Copy session ID</span>
              </button>
              {chatFirstMode && !chatFirstEmbedded ? (
                <button
                  type="button"
                  role="menuitem"
                  className="an-chat-history-row__menu-item"
                  onClick={() => {
                    closeMenu();
                    emitChatFirstSessionWatch({
                      sessionId: item.id,
                      title: item.titleText,
                      kind: "agent-chat",
                      sourceSessionId: displayedActiveThreadId ?? undefined,
                    });
                  }}
                >
                  <IconEye size={13} strokeWidth={1.8} />
                  <span>Watch and message session</span>
                </button>
              ) : null}
            </>
          )}
          className="min-w-0"
        />
      )}
    </div>
  );
}

export function NavContent({
  onNavigate,
  extensions,
  chatFirstMode = false,
  chatFirstEmbedded = false,
  collapsed = false,
  collapsible = false,
  onCollapsedChange,
  chatFirstAppLayout,
  onChatFirstAppLayoutChange,
  chatFirstApps = [],
  chatFirstAppsLoading = false,
  chatFirstAppsError,
  chatFirstActiveAppId,
  onChatFirstAppOpen,
  onChatFirstAppsRetry,
}: {
  onNavigate?: () => void;
  extensions?: DispatchExtensionConfig;
  chatFirstMode?: boolean;
  chatFirstEmbedded?: boolean;
  collapsed?: boolean;
  collapsible?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  chatFirstAppLayout?: ChatFirstAppLayoutPreference;
  onChatFirstAppLayoutChange?: (layout: ChatFirstAppLayoutPreference) => void;
  chatFirstApps?: readonly ChatFirstAppItem[];
  chatFirstAppsLoading?: boolean;
  chatFirstAppsError?: string | null;
  chatFirstActiveAppId?: string;
  onChatFirstAppOpen?: (app: ChatFirstAppItem) => void;
  onChatFirstAppsRetry?: () => void;
}) {
  const t = useT();
  const chatFirstCopy = useMemo(() => createDispatchChatFirstCopy(t), [t]);
  const location = useLocation();
  const navigate = useNavigate();
  const extensionNavItems = extensions?.navItems ?? EMPTY_NAV_ITEMS;
  const primaryNavItems = [
    ...PRIMARY_NAV_ITEMS,
    ...navItemsForSection(extensionNavItems, "primary"),
  ];
  const localPathname = localDispatchPath(location.pathname);
  const navLabel = (item: DispatchNavItem) => {
    const key =
      item.id === "thread-debug"
        ? "threadDebug"
        : item.id === "workspace"
          ? "resources"
          : item.id;
    return t(`dispatch.nav.${key}`, { defaultValue: item.label });
  };

  const collapseButton = collapsible ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => onCollapsedChange?.(!collapsed)}
          aria-label={
            collapsed
              ? t("sidebar.expandSidebar")
              : t("sidebar.collapseSidebar")
          }
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/65 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          {collapsed ? (
            <IconLayoutSidebarLeftExpand className="h-4 w-4 rtl:-scale-x-100" />
          ) : (
            <IconLayoutSidebarLeftCollapse className="h-4 w-4 rtl:-scale-x-100" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">
        {collapsed ? t("sidebar.expandSidebar") : t("sidebar.collapseSidebar")}
      </TooltipContent>
    </Tooltip>
  ) : null;
  const searchButton = (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={openCommandMenu}
          aria-label={t("sidebar.search")}
          className="flex h-8 w-8 items-center justify-center rounded-md text-sidebar-foreground/65 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <IconSearch className="h-4 w-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{t("sidebar.search")}</TooltipContent>
    </Tooltip>
  );
  const feedbackButton = (
    <FeedbackButton
      variant={collapsed ? "icon" : "sidebar"}
      side="right"
      className={collapsed ? "size-8" : "min-w-0"}
    />
  );
  const chatFirstCreateAppTrigger = (
    <CreateAppPopover
      align="start"
      trigger={
        <button
          type="button"
          className="flex size-6 items-center justify-center rounded text-sidebar-foreground/55 hover:bg-sidebar-accent hover:text-sidebar-foreground"
          aria-label={chatFirstCopy("createWorkspaceApp")}
          title={chatFirstCopy("createWorkspaceApp")}
        >
          <IconPlus size={14} aria-hidden="true" />
        </button>
      }
    />
  );

  const chatFirstAppsRail = (
    <ChatFirstAppsRail
      apps={chatFirstApps}
      activeAppId={chatFirstActiveAppId}
      collapsed={collapsed}
      loading={chatFirstAppsLoading}
      error={chatFirstAppsError}
      layout={chatFirstAppLayout}
      onLayoutChange={onChatFirstAppLayoutChange}
      onRetry={onChatFirstAppsRetry}
      onOpenApp={(app) => {
        onChatFirstAppOpen?.(app);
        onNavigate?.();
      }}
      createAppTrigger={chatFirstCreateAppTrigger}
      renderIcon={(app) => (
        <AppIcon
          id={app.id}
          name={app.name}
          size="sm"
          className="size-5 rounded-md"
        />
      )}
      copy={chatFirstCopy}
    />
  );

  const renderNavItem = (item: DispatchNavItem) => {
    const Icon = item.icon;
    const itemMatchesLocalPath = navItemMatchesPath(item, localPathname);
    const label = navLabel(item);
    return (
      <li key={item.id}>
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                to={dispatchNavLinkTarget(item.to)}
                onClick={(event) => {
                  if (
                    item.id === "chat" &&
                    localPathname !== "/chat" &&
                    !event.metaKey &&
                    !event.ctrlKey &&
                    !event.shiftKey &&
                    !event.altKey
                  ) {
                    event.preventDefault();
                    navigateWithAgentChatViewTransition(
                      navigate,
                      dispatchNavLinkTarget("/chat"),
                    );
                    onNavigate?.();
                    return;
                  }
                  onNavigate?.();
                }}
                aria-label={label}
                aria-current={itemMatchesLocalPath ? "page" : undefined}
                className={cn(
                  "flex size-9 items-center justify-center rounded-md text-sm",
                  itemMatchesLocalPath
                    ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
              >
                {Icon ? (
                  <Icon size={16} className="shrink-0" />
                ) : (
                  <span className="h-4 w-4 shrink-0" aria-hidden="true" />
                )}
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">{label}</TooltipContent>
          </Tooltip>
        ) : (
          <Link
            to={dispatchNavLinkTarget(item.to)}
            onClick={(event) => {
              if (
                item.id === "chat" &&
                localPathname !== "/chat" &&
                !event.metaKey &&
                !event.ctrlKey &&
                !event.shiftKey &&
                !event.altKey
              ) {
                event.preventDefault();
                navigateWithAgentChatViewTransition(
                  navigate,
                  dispatchNavLinkTarget("/chat"),
                );
                onNavigate?.();
                return;
              }
              onNavigate?.();
            }}
            aria-current={itemMatchesLocalPath ? "page" : undefined}
            className={cn(
              "flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm",
              itemMatchesLocalPath
                ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            )}
          >
            {Icon ? (
              <Icon size={16} className="shrink-0" />
            ) : (
              <span className="h-4 w-4 shrink-0" aria-hidden="true" />
            )}
            <span className="truncate">{label}</span>
          </Link>
        )}
        {!collapsed && item.id === "chat" && itemMatchesLocalPath ? (
          <DispatchChatsSection
            onNavigate={onNavigate}
            chatFirstMode={chatFirstMode}
            chatFirstEmbedded={chatFirstEmbedded}
          />
        ) : null}
      </li>
    );
  };

  const bottomNavigation = (
    <nav className={cn("py-1", collapsed ? "px-1.5" : "px-2")}>
      <ul
        className={cn(
          collapsed ? "flex flex-col items-center gap-1" : "space-y-0.5",
        )}
      >
        {BOTTOM_NAV_ITEMS.map(renderNavItem)}
      </ul>
    </nav>
  );
  const organizationPicker = (
    <div
      className={cn("py-2", collapsed ? "flex justify-center px-1" : "px-3")}
    >
      <OrgSwitcher compact={collapsed} reserveSpace />
    </div>
  );
  const sidebarFooterActions = (
    <SidebarFooterActions
      collapsed={collapsed}
      feedback={feedbackButton}
      search={searchButton}
      collapse={collapseButton}
    />
  );

  return (
    <>
      <div
        className={cn(
          "flex h-12 shrink-0 items-center border-b border-sidebar-border",
          collapsed ? "justify-center px-0" : "px-4",
        )}
      >
        <div
          className={cn(
            "flex items-center",
            collapsed ? "justify-center" : "gap-2",
          )}
        >
          <img
            src={appPath("/agent-native-icon-light.svg")}
            alt=""
            aria-hidden="true"
            width={35}
            height={20}
            className={cn(
              "block shrink-0 object-contain object-center dark:hidden",
              collapsed ? "h-4 w-7" : "h-5 w-[35px]",
            )}
          />
          <img
            src={appPath("/agent-native-icon-dark.svg")}
            alt=""
            aria-hidden="true"
            width={35}
            height={20}
            className={cn(
              "hidden shrink-0 object-contain object-center dark:block",
              collapsed ? "h-4 w-7" : "h-5 w-[35px]",
            )}
          />
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <div
                data-dispatch-sidebar-label
                className="truncate text-lg font-bold tracking-tight text-foreground"
              >
                {DISPATCH_SIDEBAR_LABEL}
              </div>
            </div>
          )}
        </div>
      </div>

      {chatFirstMode ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {!collapsed ? (
            <DispatchChatsSection
              onNavigate={onNavigate}
              showNewChat
              chatFirstMode
              chatFirstEmbedded={chatFirstEmbedded}
              chatFirstNavigation={{
                onOpenIntegrations: () => {
                  navigate(dispatchNavLinkTarget("/admin/integrations"));
                  onNavigate?.();
                },
                onOpenScheduled: () => {
                  navigate(dispatchNavLinkTarget("/admin/automations"));
                  onNavigate?.();
                },
              }}
              prelude={chatFirstAppsRail}
            />
          ) : (
            chatFirstAppsRail
          )}
        </div>
      ) : null}
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col overflow-y-auto",
          chatFirstMode && "hidden",
        )}
      >
        <nav className={cn("py-2", collapsed ? "px-1.5" : "px-2")}>
          <ul
            className={cn(
              collapsed ? "flex flex-col items-center gap-1" : "space-y-0.5",
            )}
          >
            {primaryNavItems.map(renderNavItem)}
          </ul>
        </nav>

        <div className="mt-auto shrink-0">
          {bottomNavigation}
          {organizationPicker}
        </div>
        {sidebarFooterActions}
      </div>
      {chatFirstMode ? (
        <div className="mt-auto shrink-0">
          {bottomNavigation}
          {organizationPicker}
          {collapsed ? sidebarFooterActions : null}
        </div>
      ) : null}
    </>
  );
}

export function Layout({
  children,
  extensions,
  agentPageHref,
}: {
  children: ReactNode;
  extensions?: DispatchExtensionConfig;
  agentPageHref?: string;
}) {
  const t = useT();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const localPathname = localDispatchPath(location.pathname);
  const isChatRoute =
    localPathname === "/chat" || localPathname.startsWith("/chat/");
  const chatFirstSurfaceScope = threadIdFromPath(localPathname) ?? "new";
  const isWorkspaceAppHostRoute = localPathname.startsWith("/apps/");
  const [chatFirstPreference, setChatFirstPreference] = useState(() =>
    readChatFirstMode(),
  );
  const chatFirstEmbedded =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("chatFirst") === "1";
  const chatFirstMode =
    extensions?.chatFirst === true || chatFirstPreference || chatFirstEmbedded;
  const [chatFirstAppLayout, setChatFirstAppLayout] =
    useState<ChatFirstAppLayoutPreference>(() => readChatFirstAppLayout());
  const chatFirstAppLayoutHydratedRef = useRef(false);
  const chatFirstAppsQuery = useActionQuery<WorkspaceAppSummary[]>(
    "list-workspace-apps",
    { includeAgentCards: false },
    { enabled: chatFirstMode && isChatRoute },
  );
  const chatFirstWorkspaceApps = useMemo(
    () => mergeChatFirstWorkspaceApps(chatFirstAppsQuery.data),
    [chatFirstAppsQuery.data],
  );
  const chatFirstAppRegistrations = useMemo<ChatFirstAppRegistration[]>(
    () =>
      chatFirstWorkspaceApps.map((app) => ({
        id: app.id,
        name: app.name,
        path: app.path,
        url: app.url,
        enabled: app.status !== "pending" && app.archived !== true,
      })),
    [chatFirstWorkspaceApps],
  );
  const chatFirstAppItems = useMemo<ChatFirstAppItem[]>(
    () =>
      chatFirstWorkspaceApps.map((app) => ({
        id: app.id,
        name: app.name,
      })),
    [chatFirstWorkspaceApps],
  );
  const chatFirstCopy = useMemo(() => createDispatchChatFirstCopy(t), [t]);
  const createChatFirstEmbedSession = useActionMutation<
    ChatFirstEmbedSessionResult,
    ChatFirstEmbedSessionInput
  >("create_embed_session", { skipActionQueryInvalidation: true });
  const [chatFirstPane, setChatFirstPane] =
    useState<DispatchChatFirstPane | null>(null);
  const [chatFirstEmbedUrl, setChatFirstEmbedUrl] = useState<string | null>(
    null,
  );
  const [chatFirstEmbedError, setChatFirstEmbedError] = useState<string | null>(
    null,
  );
  const [chatFirstEmbedAttempt, setChatFirstEmbedAttempt] = useState(0);
  const [chatFirstNotice, setChatFirstNotice] = useState<string | null>(null);
  const chatFirstSessionWatch = useChatFirstSessionWatch();
  const chatFirstSurfaceTabs = useChatFirstSurfaceTabs(chatFirstSurfaceScope);
  const chatFirstSurfaceTabsStore = getChatFirstSurfaceTabsStore(
    chatFirstSurfaceScope,
  );
  const chatFirstAgentsQuery = useActionQuery<SearchAgentThreadsResult>(
    "search-agent-threads",
    { sourceId: "current", limit: 12 },
    {
      enabled:
        chatFirstMode &&
        isChatRoute &&
        chatFirstSurfaceTabs.activeTabId?.startsWith("agents:") === true,
    },
  );
  const chatFirstSurfacePanel = useChatFirstSurfacePanel(chatFirstSurfaceScope);
  const { setOpen: setChatFirstSurfacePanelOpen } = chatFirstSurfacePanel;
  const chatFirstSurfaceResize = useChatFirstSurfaceResize(
    chatFirstSurfaceScope,
  );
  const chatFirstPaneHydratedRef = useRef(false);
  const pendingChatFirstOpenAppRef = useRef<ChatFirstOpenAppDetail | null>(
    null,
  );
  const previousChatFirstSurfaceScopeRef = useRef(chatFirstSurfaceScope);
  const previousChatFirstSurfaceTabCountRef = useRef<number | null>(null);
  const activeChatFirstSurfaceTab = useMemo(
    () =>
      chatFirstSurfaceTabs.tabs.find(
        (tab) => tab.id === chatFirstSurfaceTabs.activeTabId,
      ) ?? null,
    [chatFirstSurfaceTabs],
  );
  const activeChatFirstApp = useMemo(
    () =>
      activeChatFirstSurfaceTab?.kind === "app" &&
      activeChatFirstSurfaceTab.appId
        ? (chatFirstWorkspaceApps.find(
            (app) => app.id === activeChatFirstSurfaceTab.appId,
          ) ?? null)
        : null,
    [activeChatFirstSurfaceTab, chatFirstWorkspaceApps],
  );
  const chatFirstAgentActivities = useMemo<ChatFirstAgentActivity[]>(
    () =>
      (chatFirstAgentsQuery.data?.threads ?? []).map((thread) => ({
        sessionId: thread.id,
        title:
          thread.title || chatFirstCopy("agentsTitle", { name: thread.id }),
        subtitle: thread.snippet || thread.preview || chatFirstCopy("session"),
        status: "recent",
        ...(thread.updatedAt ? { updatedAt: thread.updatedAt } : {}),
      })),
    [chatFirstAgentsQuery.data, chatFirstCopy],
  );
  const chatFirstEmbedPath =
    activeChatFirstSurfaceTab?.kind === "app"
      ? (activeChatFirstSurfaceTab.path ??
        chatFirstPane?.path ??
        activeChatFirstApp?.path)
      : null;
  useEffect(() => {
    if (!chatFirstMode || !isChatRoute || !activeChatFirstApp) {
      setChatFirstEmbedUrl(null);
      setChatFirstEmbedError(null);
      return;
    }
    if (!chatFirstEmbedPath?.startsWith("/")) {
      setChatFirstEmbedUrl(null);
      setChatFirstEmbedError(chatFirstCopy("appUnavailable"));
      return;
    }
    let cancelled = false;
    setChatFirstEmbedUrl(null);
    setChatFirstEmbedError(null);
    void createChatFirstEmbedSession
      .mutateAsync(
        buildChatFirstEmbedSessionInput(
          activeChatFirstApp.id,
          chatFirstEmbedPath,
        ),
      )
      .then((result) => {
        if (!cancelled) setChatFirstEmbedUrl(result.startUrl);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setChatFirstEmbedError(
            cause instanceof Error
              ? cause.message
              : chatFirstCopy("appUnavailable"),
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    activeChatFirstApp,
    chatFirstCopy,
    chatFirstEmbedAttempt,
    chatFirstEmbedPath,
    chatFirstMode,
    createChatFirstEmbedSession.mutateAsync,
    isChatRoute,
  ]);
  const persistChatFirstPane = useCallback(
    (pane: DispatchChatFirstPane | null) => {
      setChatFirstPane(pane);
      void writeClientAppState(CHAT_FIRST_PANE_STATE_KEY, pane).catch(() => {
        setChatFirstNotice(
          "The app pane opened locally, but its focus could not be synced.",
        );
      });
    },
    [],
  );
  const openChatFirstPane = useCallback(
    (pane: DispatchChatFirstPane) => {
      setChatFirstNotice(null);
      closeChatFirstSessionWatch();
      const app = chatFirstAppRegistrations.find(
        (candidate) => candidate.id === pane.appId,
      );
      chatFirstSurfaceTabsStore.open({
        id: chatFirstSurfaceTabId(
          "app",
          `${pane.appId}:${pane.path ?? pane.view ?? "/"}`,
        ),
        kind: "app",
        title: app?.name ?? pane.appId,
        appId: pane.appId,
        ...(pane.path ? { path: pane.path } : {}),
        ...(pane.view ? { view: pane.view } : {}),
      });
      persistChatFirstPane(pane);
    },
    [
      chatFirstAppRegistrations,
      chatFirstSurfaceTabsStore,
      persistChatFirstPane,
    ],
  );
  const openChatFirstSurface = useCallback(
    (kind: ChatFirstSurfaceKind) => {
      if (kind !== "agents") return;
      persistChatFirstPane(null);
      closeChatFirstSessionWatch();
      chatFirstSurfaceTabsStore.open({
        id: chatFirstSurfaceTabId("agents", "activity"),
        kind: "agents",
        title: "Agents",
      });
    },
    [chatFirstSurfaceTabsStore, persistChatFirstPane],
  );
  const resolveChatFirstOpenBrowser = useCallback(
    (detail: ChatFirstOpenBrowserDetail) => {
      const resolution = resolveChatFirstBrowserTarget(detail);
      if (resolution.status === "unresolved") {
        setChatFirstNotice(
          chatFirstBrowserResolutionMessage(resolution.reason),
        );
        return;
      }
      persistChatFirstPane(null);
      closeChatFirstSessionWatch();
      setChatFirstNotice(null);
      chatFirstSurfaceTabsStore.open({
        id: chatFirstSurfaceTabId("browser", resolution.target.url),
        kind: "browser",
        title: resolution.target.title ?? "Browser",
        url: resolution.target.url,
      });
    },
    [chatFirstSurfaceTabsStore, persistChatFirstPane],
  );
  const resolveChatFirstOpenApp = useCallback(
    (detail: ChatFirstOpenAppDetail) => {
      if (chatFirstAppsQuery.isLoading) {
        pendingChatFirstOpenAppRef.current = detail;
        return;
      }
      if (chatFirstAppsQuery.isError) {
        pendingChatFirstOpenAppRef.current = null;
        setChatFirstNotice(
          "Workspace apps could not be loaded, so the requested app was not opened.",
        );
        return;
      }

      const resolution = resolveChatFirstAppTarget(
        detail,
        chatFirstAppRegistrations,
        {
          currentOrigin:
            typeof window === "undefined" ? undefined : window.location.origin,
        },
      );
      pendingChatFirstOpenAppRef.current = null;
      if (resolution.status === "unresolved") {
        setChatFirstNotice(chatFirstResolutionMessage(resolution.reason));
        return;
      }
      openChatFirstPane(resolution.target);
    },
    [
      chatFirstAppRegistrations,
      chatFirstAppsQuery.isError,
      chatFirstAppsQuery.isLoading,
      openChatFirstPane,
    ],
  );
  const sidebarBeforeAppRef = useRef<boolean | null>(null);
  const sidebarAutoCollapsedRef = useRef(false);
  const chatHomeHandoffActive = useAgentChatHomeHandoff({
    storageKey: "dispatch",
    activePath: localPathname,
    enabled: !isChatRoute,
  });
  const chatHandoffLinkOptions = {
    storageKey: "dispatch",
    isChatPath: (pathname: string) =>
      pathname === "/chat" || pathname.startsWith("/chat/"),
    requireActiveHandoff: true,
  };
  useAgentChatHomeHandoffLinks(chatHandoffLinkOptions);

  useEffect(() => {
    const handleModeChange = (event: Event) => {
      const enabled = (event as CustomEvent<{ enabled?: unknown }>).detail
        ?.enabled;
      setChatFirstPreference(enabled === true);
    };
    window.addEventListener(CHAT_FIRST_MODE_CHANGED_EVENT, handleModeChange);
    return () =>
      window.removeEventListener(
        CHAT_FIRST_MODE_CHANGED_EVENT,
        handleModeChange,
      );
  }, []);

  useEffect(() => {
    if (
      !chatFirstMode ||
      !isChatRoute ||
      chatFirstAppLayoutHydratedRef.current
    ) {
      return;
    }
    chatFirstAppLayoutHydratedRef.current = true;
    void readClientAppState<unknown>("chat-first-app-layout")
      .then((value) => {
        if (!value || typeof value !== "object") return;
        const candidate = value as Partial<ChatFirstAppLayoutPreference>;
        const ids = (input: unknown) =>
          Array.isArray(input)
            ? input.filter(
                (id): id is string =>
                  typeof id === "string" && id.trim().length > 0,
              )
            : [];
        setChatFirstAppLayout({
          pinnedIds: [...new Set(ids(candidate.pinnedIds))],
          orderedIds: [...new Set(ids(candidate.orderedIds))],
        });
      })
      .catch(() => {
        // Device-local layout remains the fallback when workspace state is unavailable.
      });
  }, [chatFirstMode, isChatRoute]);

  const persistChatFirstAppLayout = useCallback(
    (layout: ChatFirstAppLayoutPreference) => {
      setChatFirstAppLayout(layout);
      void writeClientAppState("chat-first-app-layout", layout).catch(() => {
        setChatFirstNotice(
          "App order changed locally, but workspace state could not be synced.",
        );
      });
    },
    [],
  );

  useEffect(() => {
    if (!chatFirstMode || !isChatRoute) {
      setChatFirstPane(null);
      closeChatFirstSessionWatch();
      chatFirstSurfaceTabsStore.closeAll();
      setChatFirstNotice(null);
      pendingChatFirstOpenAppRef.current = null;
      chatFirstPaneHydratedRef.current = false;
      return;
    }
    const unsubscribeApp = subscribeChatFirstOpenApp(resolveChatFirstOpenApp);
    const unsubscribeBrowser = subscribeChatFirstOpenBrowser(
      resolveChatFirstOpenBrowser,
    );
    return () => {
      unsubscribeApp();
      unsubscribeBrowser();
    };
  }, [
    chatFirstMode,
    isChatRoute,
    chatFirstSurfaceTabsStore,
    resolveChatFirstOpenApp,
    resolveChatFirstOpenBrowser,
  ]);

  useEffect(() => {
    if (
      !chatFirstMode ||
      !isChatRoute ||
      chatFirstPaneHydratedRef.current ||
      chatFirstAppsQuery.isLoading ||
      chatFirstAppsQuery.isError
    ) {
      return;
    }
    chatFirstPaneHydratedRef.current = true;
    if (chatFirstPane) return;
    let active = true;
    void readClientAppState<unknown>(CHAT_FIRST_PANE_STATE_KEY)
      .then((value) => {
        if (!active) return;
        const persisted = persistedChatFirstPane(value);
        if (!persisted) return;
        const resolution = resolveChatFirstAppTarget(
          {
            app: persisted.appId,
            path: persisted.path,
            view: persisted.view,
          },
          chatFirstAppRegistrations,
          {
            currentOrigin:
              typeof window === "undefined"
                ? undefined
                : window.location.origin,
          },
        );
        if (resolution.status === "ready") openChatFirstPane(resolution.target);
      })
      .catch(() => {
        if (active) {
          setChatFirstNotice(
            "The last app pane could not be restored from workspace state.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [
    chatFirstAppsQuery.isError,
    chatFirstAppsQuery.isLoading,
    chatFirstAppRegistrations,
    chatFirstMode,
    chatFirstPane,
    isChatRoute,
    openChatFirstPane,
  ]);

  useEffect(() => {
    if (previousChatFirstSurfaceScopeRef.current === chatFirstSurfaceScope) {
      return;
    }
    previousChatFirstSurfaceScopeRef.current = chatFirstSurfaceScope;
    persistChatFirstPane(null);
    setChatFirstEmbedUrl(null);
    setChatFirstEmbedError(null);
    setChatFirstNotice(null);
    pendingChatFirstOpenAppRef.current = null;
    chatFirstPaneHydratedRef.current = true;
    chatFirstSurfaceTabsStore.closeAll();
    setChatFirstSurfacePanelOpen(false);
    closeChatFirstSessionWatch();
  }, [
    chatFirstSurfaceScope,
    chatFirstSurfaceTabsStore,
    persistChatFirstPane,
    setChatFirstSurfacePanelOpen,
  ]);

  useEffect(() => {
    const tabCount = chatFirstSurfaceTabs.tabs.length;
    const previousTabCount = previousChatFirstSurfaceTabCountRef.current;
    if (!chatFirstMode || !isChatRoute) {
      setChatFirstSurfacePanelOpen(false);
    } else if (
      tabCount > 0 &&
      (previousTabCount === null || previousTabCount === 0)
    ) {
      setChatFirstSurfacePanelOpen(true);
    } else if (
      tabCount === 0 &&
      previousTabCount !== null &&
      previousTabCount > 0
    ) {
      setChatFirstSurfacePanelOpen(false);
    }
    previousChatFirstSurfaceTabCountRef.current = tabCount;
  }, [
    chatFirstMode,
    setChatFirstSurfacePanelOpen,
    chatFirstSurfaceTabs.tabs.length,
    isChatRoute,
  ]);

  useEffect(() => {
    const activeTab = activeChatFirstSurfaceTab;
    if (
      activeTab?.kind === "side-chat" &&
      activeTab.session &&
      !chatFirstSessionWatch.target
    ) {
      emitChatFirstSessionWatch(activeTab.session);
    }
  }, [activeChatFirstSurfaceTab, chatFirstSessionWatch.target]);

  useEffect(() => {
    const pending = pendingChatFirstOpenAppRef.current;
    if (!pending || chatFirstAppsQuery.isLoading) return;
    resolveChatFirstOpenApp(pending);
  }, [
    chatFirstAppsQuery.data,
    chatFirstAppsQuery.isError,
    chatFirstAppsQuery.isLoading,
    resolveChatFirstOpenApp,
  ]);

  useEffect(() => {
    const target = chatFirstSessionWatch.target;
    if (!target || !chatFirstMode || !isChatRoute) return;
    setChatFirstPane(null);
    chatFirstSurfaceTabsStore.open({
      id: chatFirstSurfaceTabId("side-chat", target.sessionId),
      kind: "side-chat",
      title: target.title ? `Watch · ${target.title}` : "Watched session",
      session: target,
    });
  }, [
    chatFirstMode,
    chatFirstSessionWatch.target,
    chatFirstSurfaceTabsStore,
    isChatRoute,
  ]);

  useEffect(() => {
    if (isWorkspaceAppHostRoute) {
      if (!sidebarAutoCollapsedRef.current) {
        sidebarAutoCollapsedRef.current = true;
        sidebarBeforeAppRef.current = sidebarCollapsed;
      }
      if (!sidebarCollapsed) setSidebarCollapsed(true);
      return;
    }

    if (!sidebarAutoCollapsedRef.current) return;
    sidebarAutoCollapsedRef.current = false;
    const previousSidebarState = sidebarBeforeAppRef.current;
    sidebarBeforeAppRef.current = null;
    if (
      previousSidebarState !== null &&
      previousSidebarState !== sidebarCollapsed
    ) {
      setSidebarCollapsed(previousSidebarState);
    }
  }, [isWorkspaceAppHostRoute, sidebarCollapsed]);

  useEffect(() => {
    if (typeof window === "undefined" || isWorkspaceAppHostRoute) return;
    try {
      window.localStorage.setItem(
        SIDEBAR_COLLAPSE_KEY,
        sidebarCollapsed ? "1" : "0",
      );
    } catch {
      // Ignore storage failures; the in-memory preference still works.
    }
  }, [isWorkspaceAppHostRoute, sidebarCollapsed]);

  const activateChatFirstSurfaceTab = useCallback(
    (tab: (typeof chatFirstSurfaceTabs.tabs)[number]) => {
      chatFirstSurfaceTabsStore.activate(tab.id);
      if (tab.kind === "app" && tab.appId) {
        closeChatFirstSessionWatch();
        persistChatFirstPane({
          appId: tab.appId,
          ...(tab.path ? { path: tab.path } : {}),
          ...(tab.view ? { view: tab.view } : {}),
        });
        return;
      }
      if (tab.kind === "browser" && tab.url) {
        persistChatFirstPane(null);
        closeChatFirstSessionWatch();
        return;
      }
      if (tab.kind === "side-chat" && tab.session) {
        persistChatFirstPane(null);
        emitChatFirstSessionWatch(tab.session);
        return;
      }
      if (tab.kind === "agents") {
        persistChatFirstPane(null);
        closeChatFirstSessionWatch();
      }
    },
    [
      chatFirstSurfaceTabs.tabs,
      chatFirstSurfaceTabsStore,
      persistChatFirstPane,
    ],
  );

  const closeChatFirstSurfaceTab = useCallback(
    (tab: (typeof chatFirstSurfaceTabs.tabs)[number]) => {
      const isActive = chatFirstSurfaceTabs.activeTabId === tab.id;
      if (tab.kind === "app" && isActive) persistChatFirstPane(null);
      if (tab.kind === "side-chat" && isActive) {
        closeChatFirstSessionWatch();
      }
      chatFirstSurfaceTabsStore.close(tab.id);
    },
    [chatFirstSurfaceTabs, chatFirstSurfaceTabsStore, persistChatFirstPane],
  );

  const closeAllChatFirstSurfaceTabs = useCallback(() => {
    persistChatFirstPane(null);
    closeChatFirstSessionWatch();
    chatFirstSurfaceTabsStore.closeAll();
  }, [chatFirstSurfaceTabsStore, persistChatFirstPane]);

  const renderChatFirstWatchChat = useCallback(
    (target: ChatFirstSessionReference) => (
      <AgentChatSurface
        mode="page"
        className="h-full min-h-0 w-full"
        defaultMode="chat"
        storageKey={`dispatch-session-watch:${target.sessionId}`}
        restoreActiveThread={false}
        threadUrlSync={{
          routeThreadId: target.sessionId,
          getPath: chatThreadPath,
          navigate: () => undefined,
        }}
        showHeader={false}
        showTabBar={false}
        showPageNewChatButton={false}
        chatOnly
        dynamicSuggestions={false}
        suggestions={[]}
        emptyStateDisplay="hidden"
        composerPlaceholder={t(
          "dispatch.pages.chatFirstSessionMessagePlaceholder",
        )}
      />
    ),
    [t],
  );

  const renderChatFirstSurfaceTab = useCallback(
    (tab: ChatFirstSurfaceTab) => {
      if (tab.kind === "app") {
        if (tab.id !== chatFirstSurfaceTabs.activeTabId) return null;
        const app = tab.appId
          ? (chatFirstWorkspaceApps.find(
              (candidate) => candidate.id === tab.appId,
            ) ?? null)
          : null;
        return (
          <ChatFirstAppPane
            app={app}
            status={
              chatFirstEmbedError
                ? "error"
                : chatFirstEmbedUrl
                  ? "ready"
                  : chatFirstAppsQuery.isLoading
                    ? "loading"
                    : app
                      ? "loading"
                      : "unresolved"
            }
            embedUrl={chatFirstEmbedUrl}
            errorMessage={chatFirstEmbedError}
            onRetry={() => setChatFirstEmbedAttempt((value) => value + 1)}
            renderEmbed={({ url, title }: ChatFirstEmbedTarget) => (
              <iframe
                data-dispatch-chat-first-app-frame
                src={url}
                title={title ?? chatFirstCopy("appUnavailable")}
                referrerPolicy="no-referrer"
                allow="clipboard-read; clipboard-write"
                className="h-full w-full border-0 bg-background"
              />
            )}
            copy={chatFirstCopy}
          />
        );
      }
      if (tab.kind === "browser" && tab.url) {
        return (
          <ChatFirstBrowserPane
            url={tab.url}
            title={tab.title}
            onClose={() => closeChatFirstSurfaceTab(tab)}
            renderEmbed={({ url, title, key }: ChatFirstEmbedTarget) => (
              <iframe
                key={key}
                src={url}
                title={title ?? chatFirstCopy("browserPage")}
                referrerPolicy="no-referrer"
                allow="clipboard-read; clipboard-write"
                className="h-full w-full border-0 bg-background"
              />
            )}
            copy={chatFirstCopy}
          />
        );
      }
      if (tab.kind === "side-chat") {
        const target =
          tab.session ??
          (tab.id === chatFirstSurfaceTabs.activeTabId
            ? chatFirstSessionWatch.target
            : null);
        return target ? (
          <ChatFirstSessionWatchPane
            target={target}
            onClose={() => closeChatFirstSurfaceTab(tab)}
            renderChat={renderChatFirstWatchChat}
            copy={chatFirstCopy}
          />
        ) : null;
      }
      if (tab.kind === "agents") {
        return (
          <ChatFirstAgentsPane
            activities={chatFirstAgentActivities}
            loading={chatFirstAgentsQuery.isLoading}
            error={
              chatFirstAgentsQuery.isError
                ? chatFirstAgentsQuery.error.message
                : null
            }
            onRefresh={() => void chatFirstAgentsQuery.refetch()}
            onWatch={(activity) =>
              emitChatFirstSessionWatch({
                sessionId: activity.sessionId,
                title: activity.title,
                kind: "agent-chat",
                ...(activity.goalId ? { goalId: activity.goalId } : {}),
              })
            }
            copy={chatFirstCopy}
          />
        );
      }
      return null;
    },
    [
      chatFirstAgentActivities,
      chatFirstAgentsQuery.error,
      chatFirstAgentsQuery.isError,
      chatFirstAgentsQuery.isLoading,
      chatFirstAppsQuery.isLoading,
      chatFirstCopy,
      chatFirstEmbedError,
      chatFirstEmbedUrl,
      chatFirstSessionWatch.target,
      chatFirstSurfaceTabs.activeTabId,
      chatFirstWorkspaceApps,
      closeChatFirstSurfaceTab,
      renderChatFirstWatchChat,
    ],
  );

  if (CHROMELESS_PATHS.some((path) => localPathname === path)) {
    return <>{children}</>;
  }

  if (isWorkspaceAppHostRoute) {
    return (
      <DispatchExtensionsContext.Provider value={extensions}>
        <HeaderActionsProvider>
          <div
            data-dispatch-workspace-app-chrome-less
            className="h-screen w-full overflow-hidden bg-background"
          >
            {children}
          </div>
        </HeaderActionsProvider>
      </DispatchExtensionsContext.Provider>
    );
  }

  const showHeader = !isChatRoute && !pageOwnsToolbar(localPathname);
  function openAskAgentFullscreen() {
    focusAgentChat();
    navigateWithAgentChatViewTransition(
      navigate,
      dispatchNavLinkTarget("/chat"),
    );
  }
  const sidebarSuggestions = [
    t("dispatch.sidebar.suggestionBuildApp"),
    t("dispatch.sidebar.suggestionRouteSlack"),
    t("dispatch.sidebar.suggestionGrantKey"),
  ];
  const appContent = (
    <div className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      {showHeader ? <Header onOpenMobile={() => setMobileOpen(true)} /> : null}
      <InvitationBanner />
      {isChatRoute && chatFirstMode ? (
        <ChatFirstSurfacePanelToggle
          open={chatFirstSurfacePanel.open}
          onToggle={chatFirstSurfacePanel.toggle}
          className="absolute right-3 top-2 z-[4]"
        />
      ) : null}
      {isChatRoute && chatFirstMode && chatFirstNotice ? (
        <div
          className="dispatch-chat-first-notice"
          role="status"
          aria-live="polite"
        >
          <span>{chatFirstNotice}</span>
          <button
            type="button"
            onClick={() => setChatFirstNotice(null)}
            aria-label="Dismiss app notice"
          >
            Dismiss
          </button>
        </div>
      ) : null}
      <main
        className={cn(
          "flex-1",
          isChatRoute || isWorkspaceAppHostRoute
            ? "min-h-0 overflow-hidden"
            : "overflow-y-auto",
        )}
      >
        {showHeader ? (
          <div className="mx-auto max-w-7xl space-y-10 px-4 py-6 sm:px-6">
            {children}
          </div>
        ) : (
          children
        )}
      </main>
    </div>
  );
  const content = isChatRoute ? (
    <div
      className={cn(
        "agent-layout-main-surface flex min-w-0 flex-1 overflow-hidden",
        chatFirstMode && "dispatch-chat-first-surface",
      )}
    >
      {appContent}
      {chatFirstMode && chatFirstSurfacePanel.open ? (
        <ChatFirstSurfacePanel
          width={chatFirstSurfaceResize.width}
          onResizePointerDown={chatFirstSurfaceResize.onPointerDown}
          copy={chatFirstCopy}
        >
          <ChatFirstSurfaceTabs
            tabs={chatFirstSurfaceTabs.tabs}
            activeTabId={chatFirstSurfaceTabs.activeTabId}
            onActivate={activateChatFirstSurfaceTab}
            onClose={closeChatFirstSurfaceTab}
            onCloseOthers={(tab) => {
              activateChatFirstSurfaceTab(tab);
              chatFirstSurfaceTabsStore.closeOthers(tab.id);
            }}
            onCloseToRight={(tab) => {
              const targetIndex = chatFirstSurfaceTabs.tabs.findIndex(
                (candidate) => candidate.id === tab.id,
              );
              const activeIndex = chatFirstSurfaceTabs.tabs.findIndex(
                (candidate) =>
                  candidate.id === chatFirstSurfaceTabs.activeTabId,
              );
              if (activeIndex > targetIndex) activateChatFirstSurfaceTab(tab);
              chatFirstSurfaceTabsStore.closeToRight(tab.id);
            }}
            onCloseAll={closeAllChatFirstSurfaceTabs}
            onOpenSurface={openChatFirstSurface}
            copy={chatFirstCopy}
          />
          {chatFirstSurfaceTabs.tabs.length > 0 ? (
            <ChatFirstSurfaceContent
              tabs={chatFirstSurfaceTabs.tabs}
              activeTabId={chatFirstSurfaceTabs.activeTabId}
              renderTab={renderChatFirstSurfaceTab}
            />
          ) : null}
        </ChatFirstSurfacePanel>
      ) : null}
    </div>
  ) : (
    <AgentSidebar
      position="right"
      defaultOpen={false}
      agentPageHref={agentPageHref}
      chatViewTransition
      storageKey="dispatch"
      openOnChatRunning={chatHomeHandoffActive}
      onFullscreenRequest={openAskAgentFullscreen}
      emptyStateText={t("dispatch.sidebar.emptyAgentText")}
      suggestions={sidebarSuggestions}
    >
      {appContent}
    </AgentSidebar>
  );

  return (
    <DispatchExtensionsContext.Provider value={extensions}>
      <HeaderActionsProvider>
        <div className="agent-layout-shell flex h-screen w-full overflow-hidden bg-background">
          <aside
            data-collapsed={sidebarCollapsed ? "true" : "false"}
            className={cn(
              "agent-layout-left-drawer hidden shrink-0 flex-col border-e !border-e-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out lg:flex",
              sidebarCollapsed ? "w-14" : "w-56",
            )}
          >
            <NavContent
              extensions={extensions}
              chatFirstMode={chatFirstMode}
              chatFirstEmbedded={chatFirstEmbedded}
              collapsed={sidebarCollapsed}
              chatFirstAppLayout={chatFirstAppLayout}
              onChatFirstAppLayoutChange={persistChatFirstAppLayout}
              chatFirstApps={chatFirstAppItems}
              chatFirstAppsLoading={chatFirstAppsQuery.isLoading}
              chatFirstAppsError={
                chatFirstAppsQuery.isError
                  ? chatFirstCopy("appsLoadError")
                  : null
              }
              chatFirstActiveAppId={
                activeChatFirstSurfaceTab?.kind === "app"
                  ? activeChatFirstSurfaceTab.appId
                  : undefined
              }
              onChatFirstAppOpen={(app) => openChatFirstPane({ appId: app.id })}
              onChatFirstAppsRetry={() => void chatFirstAppsQuery.refetch()}
              collapsible
              onCollapsedChange={setSidebarCollapsed}
            />
          </aside>

          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetContent
              side="left"
              className="w-72 p-0 bg-sidebar text-sidebar-foreground [&>button]:hidden"
            >
              <SheetTitle className="sr-only">
                {t("dispatch.nav.navigation")}
              </SheetTitle>
              <SheetDescription className="sr-only">
                {t("dispatch.nav.navigationDescription")}
              </SheetDescription>
              <div className="flex h-full w-full flex-col">
                <NavContent
                  extensions={extensions}
                  chatFirstMode={chatFirstMode}
                  chatFirstEmbedded={chatFirstEmbedded}
                  collapsed={false}
                  chatFirstAppLayout={chatFirstAppLayout}
                  onChatFirstAppLayoutChange={persistChatFirstAppLayout}
                  chatFirstApps={chatFirstAppItems}
                  chatFirstAppsLoading={chatFirstAppsQuery.isLoading}
                  chatFirstAppsError={
                    chatFirstAppsQuery.isError
                      ? chatFirstCopy("appsLoadError")
                      : null
                  }
                  chatFirstActiveAppId={
                    activeChatFirstSurfaceTab?.kind === "app"
                      ? activeChatFirstSurfaceTab.appId
                      : undefined
                  }
                  onChatFirstAppOpen={(app) =>
                    openChatFirstPane({ appId: app.id })
                  }
                  onChatFirstAppsRetry={() => void chatFirstAppsQuery.refetch()}
                  onNavigate={() => setMobileOpen(false)}
                />
              </div>
            </SheetContent>
          </Sheet>

          {content}
        </div>
      </HeaderActionsProvider>
    </DispatchExtensionsContext.Provider>
  );
}
