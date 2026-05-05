import { useState, type ComponentType, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router";
import {
  AgentSidebar,
  FeedbackButton,
  appPath,
  useActionQuery,
} from "@agent-native/core/client";
import { InvitationBanner } from "@agent-native/core/client/org";
import { ToolsSidebarSection } from "@agent-native/core/client/tools";
import {
  IconArrowUpRight,
  IconApps,
  IconChartBar,
  IconBrandTelegram,
  IconKey,
  IconChevronDown,
  IconLayersSubtract,
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
    id: "team",
    to: "/team",
    label: "Team",
    icon: IconUsersGroup,
    section: "operations",
  },
] as const satisfies readonly DispatchNavItem[];

const EMPTY_NAV_ITEMS: readonly DispatchNavItem[] = [];

const SIDEBAR_SUGGESTIONS = [
  "Create a new app",
  "Grant a key to an app",
  "Check integration health",
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
  const operationsOpen = operationsNavItems.some((item) =>
    navItemMatchesPath(item, location.pathname),
  );

  const renderNavItem = (item: DispatchNavItem) => {
    const Icon = item.icon;
    return (
      <li key={item.id}>
        <NavLink
          to={item.to}
          onClick={onNavigate}
          className={({ isActive }) => {
            const active =
              isActive || navItemMatchesPath(item, location.pathname);
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

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <ul className="space-y-0.5">{primaryNavItems.map(renderNavItem)}</ul>
        <details className="group mt-4" open={operationsOpen}>
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
      </nav>

      <div className="border-t px-2 py-2">
        <ToolsSidebarSection />
        <FeedbackButton />
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

  if (CHROMELESS_PATHS.some((path) => location.pathname === path)) {
    return <>{children}</>;
  }

  const showHeader = !pageOwnsToolbar(location.pathname);
  const appContent = (
    <div className="flex h-full flex-1 flex-col overflow-hidden">
      {showHeader ? <Header onOpenMobile={() => setMobileOpen(true)} /> : null}
      <InvitationBanner />
      <main className="flex-1 overflow-y-auto">
        {showHeader ? (
          <div className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6">
            {children}
          </div>
        ) : (
          children
        )}
      </main>
    </div>
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

        {/*
         * Always mount AgentSidebar so home composer's sendToAgentChat
         * fallback can pop it via agent-panel:open.
         */}
        <AgentSidebar
          position="right"
          defaultOpen={false}
          emptyStateText="Create apps, grant keys, and route work across the workspace."
          suggestions={SIDEBAR_SUGGESTIONS}
        >
          {appContent}
        </AgentSidebar>
      </div>
    </HeaderActionsProvider>
  );
}
