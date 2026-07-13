import {
  AgentSidebar,
  FeedbackButton,
  appBasePath,
  appPath,
  focusAgentChat,
  navigateWithAgentChatViewTransition,
  useActionQuery,
  useAgentChatHomeHandoff,
  useAgentChatHomeHandoffLinks,
  useChatThreads,
  useT,
  type ChatThreadSummary,
} from "@agent-native/core/client";
import { ExtensionsSidebarSection } from "@agent-native/core/client/extensions";
import { InvitationBanner, OrgSwitcher } from "@agent-native/core/client/org";
import {
  IconActivity,
  IconArrowUpRight,
  IconApps,
  IconBrain,
  IconChartBar,
  IconBrandTelegram,
  IconKey,
  IconChevronDown,
  IconDots,
  IconEdit,
  IconLayersSubtract,
  IconMessageQuestion,
  IconMessages,
  IconPlus,
  IconPlugConnected,
  IconBroadcast,
  IconFingerprint,
  IconHistory,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconPuzzle,
  IconSettings,
  IconSettingsAutomation,
  IconShieldCheck,
} from "@tabler/icons-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type FormEvent,
  type ReactNode,
} from "react";
import { NavLink, useLocation, useNavigate } from "react-router";

import { cn } from "../../lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Input } from "../ui/input";
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
  /** Defaults to "operations", which is where local management tools usually fit. */
  section?: DispatchNavSection;
  /** Override active matching for nested or multi-route tools. */
  match?: (pathname: string) => boolean;
}

export interface DispatchExtensionConfig {
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

const OPERATIONS_NAV_ITEMS = [
  {
    id: "operations",
    to: "/operations",
    label: "Operations",
    icon: IconActivity,
    section: "operations",
  },
  {
    id: "metrics",
    to: "/metrics",
    label: "Metrics",
    icon: IconChartBar,
    section: "operations",
  },
  {
    id: "automations",
    to: "/automations",
    label: "Automations",
    icon: IconSettingsAutomation,
    section: "operations",
  },
  {
    id: "approvals",
    to: "/approvals",
    label: "Approvals",
    icon: IconShieldCheck,
    section: "operations",
  },
  {
    id: "destinations",
    to: "/destinations",
    label: "Destinations",
    icon: IconArrowUpRight,
    section: "operations",
  },
  {
    id: "integrations",
    to: "/integrations",
    label: "Integrations",
    icon: IconPuzzle,
    section: "operations",
  },
  {
    id: "vault",
    to: "/vault",
    label: "Vault",
    icon: IconKey,
    section: "operations",
  },
  {
    id: "agents",
    to: "/agents",
    label: "Agents",
    icon: IconPlugConnected,
    section: "operations",
  },
  {
    id: "workspace",
    to: "/workspace",
    label: "Resources",
    icon: IconLayersSubtract,
    section: "operations",
  },
  {
    id: "settings",
    to: "/settings",
    label: "Settings",
    icon: IconSettings,
    section: "operations",
  },
] as const satisfies readonly DispatchNavItem[];

const ADVANCED_NAV_ITEMS = [
  {
    id: "messaging",
    to: "/messaging",
    label: "Messaging",
    icon: IconBrandTelegram,
    section: "operations",
  },
  {
    id: "identities",
    to: "/identities",
    label: "Identities",
    icon: IconFingerprint,
    section: "operations",
  },
  {
    id: "audit",
    to: "/audit",
    label: "Audit",
    icon: IconHistory,
    section: "operations",
  },
  {
    id: "dreams",
    to: "/dreams",
    label: "Dreams",
    icon: IconBrain,
    section: "operations",
  },
  {
    id: "thread-debug",
    to: "/thread-debug",
    label: "Thread Debug",
    icon: IconMessages,
    section: "operations",
  },
] as const satisfies readonly DispatchNavItem[];

const EMPTY_NAV_ITEMS: readonly DispatchNavItem[] = [];

const CHROMELESS_PATHS = ["/approval"];
const SIDEBAR_COLLAPSE_KEY = "dispatch.sidebar.collapsed";

// Routes whose page renders its own toolbar.
// Layout still mounts the sidebar + AgentSidebar, but skips its own Header so
// there's no double-header.
function pageOwnsToolbar(pathname: string): boolean {
  if (pathname === "/tools" || pathname.startsWith("/tools/")) return true;
  if (pathname === "/extensions" || pathname.startsWith("/extensions/"))
    return true;
  return false;
}

interface WorkspaceInfo {
  name: string | null;
  displayName: string | null;
  appCount: number;
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

function chatThreadPath(threadId: string): string {
  return `/chat/${encodeURIComponent(threadId)}`;
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

function threadUpdatedAt(thread: ChatThreadSummary) {
  return Number.isFinite(thread.updatedAt)
    ? thread.updatedAt
    : Number.isFinite(thread.createdAt)
      ? thread.createdAt
      : 0;
}

function DispatchChatsSection({ onNavigate }: { onNavigate?: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const {
    threads,
    activeThreadId,
    isLoading: chatsLoading,
    createThread,
    switchThread,
    renameThread,
    refreshThreads,
  } = useChatThreads(undefined, "dispatch", undefined, { autoCreate: false });
  const [renamingThreadId, setRenamingThreadId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const committingRenameRef = useRef(false);

  const visibleThreads = useMemo(
    () =>
      threads
        .filter(
          (thread) => thread.messageCount > 0 || thread.id === activeThreadId,
        )
        .sort((a, b) => threadUpdatedAt(b) - threadUpdatedAt(a))
        .slice(0, 8),
    [activeThreadId, threads],
  );

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

  useEffect(() => {
    if (!renamingThreadId) return;
    requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
  }, [renamingThreadId]);

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

  function startRenameThread(thread: ChatThreadSummary) {
    committingRenameRef.current = false;
    setRenameDraft(threadTitle(thread, t("dispatch.sidebar.newChat")));
    setRenamingThreadId(thread.id);
  }

  function cancelRenameThread() {
    committingRenameRef.current = true;
    setRenamingThreadId(null);
    setRenameDraft("");
  }

  async function commitRenameThread() {
    if (committingRenameRef.current) return;
    const threadId = renamingThreadId;
    const title = renameDraft.trim();
    if (!threadId) return;
    committingRenameRef.current = true;
    setRenamingThreadId(null);
    setRenameDraft("");
    if (title) await renameThread(threadId, title);
    committingRenameRef.current = false;
  }

  function handleRenameSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void commitRenameThread();
  }

  return (
    <div className="ms-4 min-w-0 space-y-0.5">
      {chatsLoading &&
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
      {visibleThreads.map((thread) => {
        const localPathname = localDispatchPath(location.pathname);
        const isActive =
          thread.id ===
          (threadIdFromPath(localPathname) ??
            (localPathname === "/chat" ? null : activeThreadId));
        const isRenaming = thread.id === renamingThreadId;
        const title = threadTitle(thread, t("dispatch.sidebar.newChat"));
        return (
          <div
            key={thread.id}
            className={cn(
              "group/item relative flex min-w-0 items-center rounded-lg transition-colors",
              isActive
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground",
            )}
          >
            {isRenaming ? (
              <form
                onSubmit={handleRenameSubmit}
                className="flex min-w-0 flex-1 items-center px-1"
              >
                <Input
                  ref={renameInputRef}
                  value={renameDraft}
                  onChange={(event) => setRenameDraft(event.target.value)}
                  onBlur={() => void commitRenameThread()}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      cancelRenameThread();
                    }
                  }}
                  maxLength={160}
                  aria-label={t("dispatch.sidebar.renameThread", { title })}
                  className="h-6 min-w-0 rounded-sm border-sidebar-border bg-background px-1.5 text-xs"
                />
              </form>
            ) : (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => openThread(thread.id)}
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-2 py-1.5 pe-1 text-start text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="block min-w-0 flex-1 truncate">
                        {title}
                      </span>
                      <time className="w-8 shrink-0 whitespace-nowrap text-end text-[11px] tabular-nums text-muted-foreground/60 transition-opacity group-hover/item:opacity-0 group-focus-within/item:opacity-0">
                        {isActive
                          ? ""
                          : formatThreadAge(threadUpdatedAt(thread))}
                      </time>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">{title}</TooltipContent>
                </Tooltip>
                <div className="pointer-events-none absolute end-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
                  <DropdownMenu>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            aria-label={t("dispatch.sidebar.chatOptions", {
                              title,
                            })}
                            className="pointer-events-auto rounded p-0.5 text-muted-foreground/50 opacity-0 transition-[color,opacity] hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover/item:opacity-100 group-focus-within/item:opacity-100 data-[state=open]:opacity-100 data-[state=open]:text-foreground"
                          >
                            <IconDots className="size-3" />
                          </button>
                        </DropdownMenuTrigger>
                      </TooltipTrigger>
                      <TooltipContent side="right">
                        {t("dispatch.sidebar.chatOptions", { title })}
                      </TooltipContent>
                    </Tooltip>
                    <DropdownMenuContent
                      align="start"
                      side="right"
                      className="w-44"
                    >
                      <DropdownMenuItem
                        onSelect={() => startRenameThread(thread)}
                      >
                        <IconEdit className="size-3.5" />
                        {t("dispatch.sidebar.renameChat")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </>
            )}
          </div>
        );
      })}
      <button
        type="button"
        onClick={() => void handleNewChat()}
        className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5 text-xs text-muted-foreground/60 transition-colors hover:bg-sidebar-accent/50 hover:text-foreground"
      >
        <IconPlus className="size-3 shrink-0" />
        <span className="truncate">{t("dispatch.sidebar.newChat")}</span>
      </button>
    </div>
  );
}

export function NavContent({
  onNavigate,
  extensions,
  collapsed = false,
  collapsible = false,
  onCollapsedChange,
}: {
  onNavigate?: () => void;
  extensions?: DispatchExtensionConfig;
  collapsed?: boolean;
  collapsible?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}) {
  const t = useT();
  const location = useLocation();
  const navigate = useNavigate();
  const { data: workspace } = useActionQuery(
    "get-workspace-info",
    {},
    { staleTime: 60_000 },
  );
  const ws = workspace as WorkspaceInfo | undefined;
  const workspaceLabel = ws?.displayName ?? ws?.name ?? null;
  const extensionNavItems = extensions?.navItems ?? EMPTY_NAV_ITEMS;
  const primaryNavItems = [
    ...PRIMARY_NAV_ITEMS,
    ...navItemsForSection(extensionNavItems, "primary"),
  ];
  const operationsNavItems = [
    ...OPERATIONS_NAV_ITEMS,
    ...navItemsForSection(extensionNavItems, "operations"),
  ];
  const localPathname = localDispatchPath(location.pathname);
  const advancedOpen = ADVANCED_NAV_ITEMS.some((item) =>
    navItemMatchesPath(item, localPathname),
  );
  const navLabel = (item: DispatchNavItem) => {
    const key =
      item.id === "thread-debug"
        ? "threadDebug"
        : item.id === "workspace"
          ? "resources"
          : item.id;
    return t(`dispatch.nav.${key}`, { defaultValue: item.label });
  };

  const renderNavItem = (item: DispatchNavItem) => {
    const Icon = item.icon;
    const itemMatchesLocalPath = navItemMatchesPath(item, localPathname);
    const label = navLabel(item);
    return (
      <li key={item.id}>
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <NavLink
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
                className={({ isActive }) => {
                  const active = isActive || itemMatchesLocalPath;
                  return cn(
                    "flex h-10 w-10 items-center justify-center rounded-md text-sm",
                    active
                      ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  );
                }}
              >
                {Icon ? (
                  <Icon size={16} className="shrink-0" />
                ) : (
                  <span className="h-4 w-4 shrink-0" aria-hidden="true" />
                )}
              </NavLink>
            </TooltipTrigger>
            <TooltipContent side="right">{label}</TooltipContent>
          </Tooltip>
        ) : (
          <NavLink
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
            className={({ isActive }) => {
              const active = isActive || itemMatchesLocalPath;
              return cn(
                "flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm",
                active
                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              );
            }}
          >
            {Icon ? (
              <Icon size={16} className="shrink-0" />
            ) : (
              <span className="h-4 w-4 shrink-0" aria-hidden="true" />
            )}
            <span className="truncate">{label}</span>
          </NavLink>
        )}
        {!collapsed && item.id === "chat" && itemMatchesLocalPath ? (
          <DispatchChatsSection onNavigate={onNavigate} />
        ) : null}
      </li>
    );
  };

  return (
    <>
      <div className={cn("border-b py-3", collapsed ? "px-1" : "px-4")}>
        <div
          className={cn(
            "flex items-center",
            collapsed ? "justify-center" : "gap-2",
          )}
        >
          {!collapsed && (
            <>
              <img
                src={appPath("/agent-native-icon-light.svg")}
                alt=""
                aria-hidden="true"
                className="block h-5 w-auto shrink-0 dark:hidden"
              />
              <img
                src={appPath("/agent-native-icon-dark.svg")}
                alt=""
                aria-hidden="true"
                className="hidden h-5 w-auto shrink-0 dark:block"
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-lg font-bold tracking-tight text-foreground">
                  {workspaceLabel ?? "Dispatch"}
                </div>
              </div>
            </>
          )}
          {collapsible ? (
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
                {collapsed
                  ? t("sidebar.expandSidebar")
                  : t("sidebar.collapseSidebar")}
              </TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <nav className={cn("py-3", collapsed ? "px-1" : "px-2")}>
          <ul
            className={cn(
              "space-y-0.5",
              collapsed && "flex flex-col items-center",
            )}
          >
            {primaryNavItems.map(renderNavItem)}
          </ul>

          {collapsed ? (
            <ul className="mt-2 flex flex-col items-center space-y-0.5">
              {[...operationsNavItems, ...ADVANCED_NAV_ITEMS].map(
                renderNavItem,
              )}
            </ul>
          ) : (
            <div className="mt-5">
              <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-sidebar-foreground/45">
                {t("dispatch.nav.operate", { defaultValue: "Operate" })}
              </p>
              <ul className="space-y-0.5">
                {operationsNavItems.map(renderNavItem)}
              </ul>

              <details className="group mt-3" open={advancedOpen}>
                <summary className="flex h-8 cursor-pointer list-none items-center justify-between rounded-md px-2 text-xs font-medium text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground [&::-webkit-details-marker]:hidden">
                  <span>
                    {t("dispatch.nav.advanced", { defaultValue: "Advanced" })}
                  </span>
                  <IconChevronDown
                    size={14}
                    className="transition-transform group-open:rotate-180"
                  />
                </summary>
                <ul className="mt-1 space-y-0.5">
                  {ADVANCED_NAV_ITEMS.map(renderNavItem)}
                </ul>
              </details>
            </div>
          )}
        </nav>

        {!collapsed ? (
          <div className="mt-auto shrink-0">
            <div className="px-2 py-1">
              <ExtensionsSidebarSection />
            </div>

            <div className="px-3 py-2">
              <OrgSwitcher />
            </div>

            <div className="px-3 py-2">
              <FeedbackButton />
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}

export function Layout({
  children,
  extensions,
}: {
  children: ReactNode;
  extensions?: DispatchExtensionConfig;
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
  const chatHomeHandoffActive = useAgentChatHomeHandoff({
    storageKey: "dispatch",
    activePath: localPathname,
    enabled: !isChatRoute,
  });
  const chatHandoffLinkOptions = {
    storageKey: "dispatch",
    isChatPath: (pathname: string) =>
      pathname === "/chat" || pathname.startsWith("/chat/"),
  };
  useAgentChatHomeHandoffLinks(chatHandoffLinkOptions);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        SIDEBAR_COLLAPSE_KEY,
        sidebarCollapsed ? "1" : "0",
      );
    } catch {
      // Ignore storage failures; the in-memory preference still works.
    }
  }, [sidebarCollapsed]);

  if (CHROMELESS_PATHS.some((path) => localPathname === path)) {
    return <>{children}</>;
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
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      {showHeader ? <Header onOpenMobile={() => setMobileOpen(true)} /> : null}
      <InvitationBanner />
      <main
        className={cn(
          "flex-1",
          isChatRoute ? "min-h-0 overflow-hidden" : "overflow-y-auto",
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
    <div className="agent-layout-main-surface flex min-w-0 flex-1 overflow-hidden">
      {appContent}
    </div>
  ) : (
    <AgentSidebar
      position="right"
      defaultOpen={false}
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
    <HeaderActionsProvider>
      <div className="agent-layout-shell flex h-screen w-full overflow-hidden bg-background">
        <aside
          data-collapsed={sidebarCollapsed ? "true" : "false"}
          className={cn(
            "agent-layout-left-drawer hidden shrink-0 flex-col border-e bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out lg:flex",
            sidebarCollapsed ? "w-12" : "w-64",
          )}
        >
          <NavContent
            extensions={extensions}
            collapsed={sidebarCollapsed}
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
                collapsed={false}
                onNavigate={() => setMobileOpen(false)}
              />
            </div>
          </SheetContent>
        </Sheet>

        {content}
      </div>
    </HeaderActionsProvider>
  );
}
