import {
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { NavLink, useLocation, useNavigate } from "react-router";
import {
  AgentSidebar,
  FeedbackButton,
  appBasePath,
  appPath,
  useActionQuery,
  useChatThreads,
  type ChatThreadSummary,
} from "@agent-native/core/client";
import { ExtensionsSidebarSection } from "@agent-native/core/client/extensions";
import { InvitationBanner, OrgSwitcher } from "@agent-native/core/client/org";
import {
  IconArrowUpRight,
  IconApps,
  IconBrain,
  IconChartBar,
  IconBrandTelegram,
  IconKey,
  IconChevronDown,
  IconLayersSubtract,
  IconMessageQuestion,
  IconMessages,
  IconPlus,
  IconPlugConnected,
  IconBroadcast,
  IconFingerprint,
  IconHistory,
  IconPuzzle,
  IconShieldCheck,
  IconUsersGroup,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
    id: "chat",
    to: "/chat",
    label: "Chat",
    icon: IconMessageQuestion,
    section: "primary",
  },
  {
    id: "overview",
    to: "/overview",
    label: "Overview",
    icon: IconBroadcast,
    section: "primary",
  },
  {
    id: "apps",
    to: "/apps",
    label: "Apps",
    icon: IconApps,
    section: "primary",
  },
  {
    id: "metrics",
    to: "/metrics",
    label: "Metrics",
    icon: IconChartBar,
    section: "primary",
  },
  {
    id: "vault",
    to: "/vault",
    label: "Vault",
    icon: IconKey,
    section: "primary",
  },
  {
    id: "integrations",
    to: "/integrations",
    label: "Integrations",
    icon: IconPuzzle,
    section: "primary",
  },
  {
    id: "agents",
    to: "/agents",
    label: "Agents",
    icon: IconPlugConnected,
    section: "primary",
  },
] as const satisfies readonly DispatchNavItem[];

const OPERATIONS_NAV_ITEMS = [
  {
    id: "workspace",
    to: "/workspace",
    label: "Resources",
    icon: IconLayersSubtract,
    section: "operations",
  },
  {
    id: "messaging",
    to: "/messaging",
    label: "Messaging",
    icon: IconBrandTelegram,
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
    id: "identities",
    to: "/identities",
    label: "Identities",
    icon: IconFingerprint,
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
  {
    id: "team",
    to: "/team",
    label: "Team",
    icon: IconUsersGroup,
    section: "operations",
  },
] as const satisfies readonly DispatchNavItem[];

const EMPTY_NAV_ITEMS: readonly DispatchNavItem[] = [];

const SIDEBAR_SUGGESTIONS = [
  "Build a workspace app for X",
  "Route Slack mentions to my analytics app",
  "Grant my OpenAI key to this app",
];

const CHROMELESS_PATHS = ["/approval"];

// Routes whose page renders its own toolbar (with NotificationsBell + AgentToggleButton).
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

function formatThreadAge(updatedAt: number) {
  const diffMs = Math.max(0, Date.now() - updatedAt);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(updatedAt).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

function threadTitle(thread: ChatThreadSummary) {
  return thread.title || thread.preview || "New chat";
}

function DispatchChatsSection({ onNavigate }: { onNavigate?: () => void }) {
  const navigate = useNavigate();
  const {
    threads,
    activeThreadId,
    createThread,
    switchThread,
    refreshThreads,
  } = useChatThreads(undefined, undefined, undefined, { autoCreate: false });

  const visibleThreads = useMemo(
    () =>
      threads
        .filter(
          (thread) => thread.messageCount > 0 || thread.id === activeThreadId,
        )
        .sort((a, b) => b.updatedAt - a.updatedAt)
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

  function openThread(threadId: string, options?: { isNew?: boolean }) {
    switchThread(threadId);
    navigate(dispatchNavLinkTarget("/chat"));
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
    <div className="mt-2 border-l border-sidebar-border/70 pl-3">
      <div className="mb-1 flex h-7 items-center gap-2 pr-1">
        <div className="min-w-0 flex-1 text-xs font-medium text-sidebar-foreground/70">
          Chats
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={handleNewChat}
              className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-sidebar-foreground/65 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              aria-label="New Dispatch chat"
            >
              <IconPlus className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>New chat</TooltipContent>
        </Tooltip>
      </div>
      <div className="grid gap-0.5">
        {visibleThreads.length > 0 ? (
          visibleThreads.map((thread) => {
            const isActive = thread.id === activeThreadId;
            return (
              <button
                key={thread.id}
                type="button"
                onClick={() => openThread(thread.id)}
                className={cn(
                  "flex h-8 min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 text-left text-sm transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/65 hover:text-sidebar-accent-foreground",
                )}
              >
                <span className="min-w-0 flex-1 truncate">
                  {threadTitle(thread)}
                </span>
                <span className="shrink-0 text-[11px] text-sidebar-foreground/50">
                  {isActive ? "" : formatThreadAge(thread.updatedAt)}
                </span>
              </button>
            );
          })
        ) : (
          <button
            type="button"
            onClick={handleNewChat}
            className="flex h-8 cursor-pointer items-center rounded-md px-2 text-left text-sm text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent/65 hover:text-sidebar-accent-foreground"
          >
            <span className="truncate">New chat</span>
          </button>
        )}
      </div>
    </div>
  );
}

export function NavContent({
  onNavigate,
  extensions,
}: {
  onNavigate?: () => void;
  extensions?: DispatchExtensionConfig;
}) {
  const location = useLocation();
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
  const operationsOpen = operationsNavItems.some((item) =>
    navItemMatchesPath(item, localPathname),
  );

  const renderNavItem = (item: DispatchNavItem) => {
    const Icon = item.icon;
    return (
      <li key={item.id}>
        <NavLink
          to={dispatchNavLinkTarget(item.to)}
          onClick={onNavigate}
          className={({ isActive }) => {
            const active = isActive || navItemMatchesPath(item, localPathname);
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
          <span className="truncate">{item.label}</span>
        </NavLink>
        {item.id === "chat" ? (
          <DispatchChatsSection onNavigate={onNavigate} />
        ) : null}
      </li>
    );
  };

  return (
    <>
      <div className="border-b px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border bg-card text-foreground">
            <img
              src={appPath("/agent-native-icon-light.svg")}
              alt=""
              aria-hidden="true"
              className="block h-4 w-auto shrink-0 dark:hidden"
            />
            <img
              src={appPath("/agent-native-icon-dark.svg")}
              alt=""
              aria-hidden="true"
              className="hidden h-4 w-auto shrink-0 dark:block"
            />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-foreground">
              {workspaceLabel ?? "Dispatch"}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {workspaceLabel
                ? `Workspace · ${ws?.appCount ?? 0} app${ws?.appCount === 1 ? "" : "s"}`
                : "Workspace control plane"}
            </div>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <nav className="px-2 py-3">
          <ul className="space-y-0.5">{primaryNavItems.map(renderNavItem)}</ul>
        </nav>

        <div className="mt-auto shrink-0">
          <div className="border-t px-2 py-2">
            <details className="group" open={operationsOpen}>
              <summary className="flex h-8 cursor-pointer list-none items-center justify-between rounded-md px-2 text-xs font-medium uppercase text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground [&::-webkit-details-marker]:hidden">
                <span>Operations</span>
                <IconChevronDown
                  size={14}
                  className="transition-transform group-open:rotate-180"
                />
              </summary>
              <ul className="mt-1 space-y-0.5">
                {operationsNavItems.map(renderNavItem)}
              </ul>
            </details>
          </div>

          <div className="border-t px-2 py-1">
            <ExtensionsSidebarSection />
          </div>

          <div className="border-t px-3 py-2">
            <OrgSwitcher />
          </div>

          <div className="border-t px-3 py-2">
            <FeedbackButton />
          </div>
        </div>
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
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const localPathname = localDispatchPath(location.pathname);

  if (CHROMELESS_PATHS.some((path) => localPathname === path)) {
    return <>{children}</>;
  }

  const isChatRoute = localPathname === "/chat";
  const showHeader = !isChatRoute && !pageOwnsToolbar(localPathname);
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
    appContent
  ) : (
    <AgentSidebar
      position="right"
      defaultOpen={false}
      emptyStateText="Create apps, manage vault keys, and route work across the workspace."
      suggestions={SIDEBAR_SUGGESTIONS}
    >
      {appContent}
    </AgentSidebar>
  );

  return (
    <HeaderActionsProvider>
      <div className="flex h-screen w-full overflow-hidden bg-background">
        <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
          <NavContent extensions={extensions} />
        </aside>

        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent
            side="left"
            className="w-72 p-0 bg-sidebar text-sidebar-foreground [&>button]:hidden"
          >
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <SheetDescription className="sr-only">
              Workspace navigation links
            </SheetDescription>
            <div className="flex h-full w-full flex-col">
              <NavContent
                extensions={extensions}
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
