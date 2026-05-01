import { useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router";
import { AgentSidebar, FeedbackButton } from "@agent-native/core/client";
import { InvitationBanner } from "@agent-native/core/client/org";
import { ToolsSidebarSection } from "@agent-native/core/client/tools";
import {
  IconArrowUpRight,
  IconApps,
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

const PRIMARY_NAV_ITEMS = [
  { to: "/overview", label: "Overview", icon: IconBroadcast },
  { to: "/apps", label: "Apps", icon: IconApps },
  { to: "/vault", label: "Vault", icon: IconKey },
  { to: "/integrations", label: "Integrations", icon: IconPuzzle },
  { to: "/agents", label: "Agents", icon: IconPlugConnected },
] as const;

const OPERATIONS_NAV_ITEMS = [
  { to: "/workspace", label: "Resources", icon: IconLayersSubtract },
  { to: "/messaging", label: "Messaging", icon: IconBrandTelegram },
  { to: "/destinations", label: "Destinations", icon: IconArrowUpRight },
  { to: "/identities", label: "Identities", icon: IconFingerprint },
  { to: "/approvals", label: "Approvals", icon: IconShieldCheck },
  { to: "/audit", label: "Audit", icon: IconHistory },
  { to: "/team", label: "Team", icon: IconUsersGroup },
] as const;

type NavItem =
  | (typeof PRIMARY_NAV_ITEMS)[number]
  | (typeof OPERATIONS_NAV_ITEMS)[number];

const SIDEBAR_SUGGESTIONS = [
  "Create a new app",
  "Grant a key to an app",
  "Check integration health",
];

const CHROMELESS_PATHS = ["/approval"];

function NavContent({ onNavigate }: { onNavigate?: () => void }) {
  const location = useLocation();
  const operationsOpen = OPERATIONS_NAV_ITEMS.some(
    (item) =>
      location.pathname === item.to ||
      location.pathname.startsWith(`${item.to}/`),
  );

  const renderNavItem = (item: NavItem) => {
    const Icon = item.icon;
    return (
      <li key={item.to}>
        <NavLink
          to={item.to}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm",
              isActive
                ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            )
          }
        >
          <Icon size={16} className="shrink-0" />
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
              src="/agent-native-icon-light.svg"
              alt=""
              aria-hidden="true"
              className="block h-4 w-auto shrink-0 dark:hidden"
            />
            <img
              src="/agent-native-icon-dark.svg"
              alt=""
              aria-hidden="true"
              className="hidden h-4 w-auto shrink-0 dark:block"
            />
          </div>
          <div>
            <div className="text-sm font-semibold text-foreground">
              Dispatch
            </div>
            <div className="text-xs text-muted-foreground">
              Workspace control plane
            </div>
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <ul className="space-y-0.5">{PRIMARY_NAV_ITEMS.map(renderNavItem)}</ul>
        <details className="group mt-4" open={operationsOpen}>
          <summary className="flex h-8 cursor-pointer list-none items-center justify-between rounded-md px-2 text-xs font-medium uppercase text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground [&::-webkit-details-marker]:hidden">
            <span>Operations</span>
            <IconChevronDown
              size={14}
              className="transition-transform group-open:rotate-180"
            />
          </summary>
          <ul className="mt-1 space-y-0.5">
            {OPERATIONS_NAV_ITEMS.map(renderNavItem)}
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

export function Layout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  if (CHROMELESS_PATHS.some((path) => location.pathname === path)) {
    return <>{children}</>;
  }

  return (
    <HeaderActionsProvider>
      <div className="flex h-screen w-full overflow-hidden bg-background">
        <aside className="hidden 2xl:flex w-64 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
          <NavContent />
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
              <NavContent onNavigate={() => setMobileOpen(false)} />
            </div>
          </SheetContent>
        </Sheet>

        <AgentSidebar
          position="right"
          defaultOpen={false}
          emptyStateText="Create apps, grant keys, and route work across the workspace."
          suggestions={SIDEBAR_SUGGESTIONS}
        >
          <div className="flex h-full flex-1 flex-col overflow-hidden">
            <Header onOpenMobile={() => setMobileOpen(true)} />
            <InvitationBanner />
            <main className="flex-1 overflow-y-auto">
              <div className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6">
                {children}
              </div>
            </main>
          </div>
        </AgentSidebar>
      </div>
    </HeaderActionsProvider>
  );
}
