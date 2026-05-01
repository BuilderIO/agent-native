import { useState, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import {
  useIsFetching,
  useIsMutating,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { AgentSidebar } from "@agent-native/core/client";
import { ToolsSidebarSection } from "@agent-native/core/client/tools";
import { FeedbackButton } from "@agent-native/core/client";
import { agentNativePath } from "@agent-native/core/client";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  IconFlame,
  IconLoader2,
  IconChartBar,
  IconSettings,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Header } from "./Header";
import { HeaderActionsProvider } from "./HeaderActions";

const navItems = [
  { icon: IconFlame, label: "Entry", href: "/" },
  { icon: IconChartBar, label: "Analytics", href: "/analytics" },
  { icon: IconSettings, label: "Settings", href: "/settings" },
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("macros:left-sidebar-collapsed") === "1";
  });

  const isAnalytics = location.pathname === "/analytics";

  // Auto-close sidebar on route change (mobile)
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    window.localStorage.setItem(
      "macros:left-sidebar-collapsed",
      desktopSidebarCollapsed ? "1" : "0",
    );
  }, [desktopSidebarCollapsed]);

  // Navigation state sync - write current view to application state
  useEffect(() => {
    const view = isAnalytics ? "analytics" : "entry";
    apiFetch(agentNativePath("/_agent-native/application-state/navigation"), {
      method: "PUT",
      body: JSON.stringify({ view, path: location.pathname }),
    }).catch(() => {});
  }, [location.pathname, isAnalytics]);

  // Poll for navigate commands from the agent
  const { data: navCommand } = useQuery({
    queryKey: ["navigate-command"],
    queryFn: async () => {
      try {
        const res = await fetch(
          agentNativePath("/_agent-native/application-state/navigate"),
        );
        if (!res.ok) return null;
        return await res.json();
      } catch {
        return null;
      }
    },
    refetchInterval: 2000,
  });

  useEffect(() => {
    if (navCommand) {
      const commandValue =
        "value" in navCommand ? navCommand.value : navCommand;
      const cmd =
        typeof commandValue === "string"
          ? JSON.parse(commandValue)
          : commandValue;
      if (cmd.view === "analytics") {
        navigate("/analytics");
      } else if (cmd.view === "entry") {
        navigate("/");
      }
      // Clear the command
      fetch(agentNativePath("/_agent-native/application-state/navigate"), {
        method: "DELETE",
      }).catch(() => {});
      queryClient.setQueryData(["navigate-command"], null);
    }
  }, [navCommand, navigate, queryClient]);

  return (
    <HeaderActionsProvider>
      <AgentSidebar
        position="right"
        defaultOpen={false}
        animateMobile
        emptyStateText="Just tell me what you ate — I'll estimate the macros"
        suggestions={[
          "Fried chicken dinner, 600 cal",
          "Oatmeal with banana for breakfast",
          "What are my macros today?",
          "Protein shake after gym",
        ]}
      >
        <div className="flex flex-1 overflow-hidden">
          {/* Desktop sidebar */}
          <aside
            className={cn(
              "hidden shrink-0 flex-col border-r border-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 md:flex",
              desktopSidebarCollapsed ? "w-14" : "w-56",
            )}
          >
            <SidebarContent
              pathname={location.pathname}
              collapsed={desktopSidebarCollapsed}
              onToggleCollapsed={() =>
                setDesktopSidebarCollapsed((collapsed) => !collapsed)
              }
            />
          </aside>

          {/* Mobile sidebar sheet */}
          <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
            <SheetContent side="left" className="w-56 p-0">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <SidebarContent pathname={location.pathname} />
            </SheetContent>
          </Sheet>

          {/* Page content */}
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <Header onOpenSidebar={() => setSidebarOpen(true)} />
            <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
          </div>
          <SyncIndicator sidebarCollapsed={desktopSidebarCollapsed} />
        </div>
      </AgentSidebar>
    </HeaderActionsProvider>
  );
}

function SidebarContent({
  pathname,
  collapsed = false,
  onToggleCollapsed,
}: {
  pathname: string;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}) {
  const ToggleIcon = collapsed
    ? IconLayoutSidebarLeftExpand
    : IconLayoutSidebarLeftCollapse;

  return (
    <div className="flex h-full flex-col">
      <div
        className={cn(
          "flex h-12 shrink-0 items-center border-b border-border",
          collapsed ? "justify-center px-2" : "gap-2 px-4",
        )}
      >
        {!collapsed && (
          <div className="flex min-w-0 flex-1 items-center gap-2">
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
            <span className="font-logo truncate text-sm font-bold tracking-tight text-foreground">
              Macros
            </span>
          </div>
        )}
        {onToggleCollapsed && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={
                  collapsed ? "Expand left sidebar" : "Collapse left sidebar"
                }
                className={cn(
                  "hidden h-8 w-8 text-muted-foreground hover:text-foreground md:inline-flex",
                  collapsed && "mx-auto",
                )}
                onClick={onToggleCollapsed}
              >
                <ToggleIcon className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {collapsed ? "Expand sidebar" : "Collapse sidebar"}
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            item.href === "/"
              ? pathname === "/" || pathname === "/entry"
              : pathname.startsWith(item.href);
          const link = (
            <Link
              key={item.href}
              to={item.href}
              aria-label={collapsed ? item.label : undefined}
              className={cn(
                "flex h-9 items-center rounded-lg text-sm transition-colors",
                collapsed ? "justify-center px-0" : "gap-3 px-3",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!collapsed && item.label}
            </Link>
          );
          return collapsed ? (
            <Tooltip key={item.href}>
              <TooltipTrigger asChild>{link}</TooltipTrigger>
              <TooltipContent side="right">{item.label}</TooltipContent>
            </Tooltip>
          ) : (
            link
          );
        })}
      </nav>

      {!collapsed && (
        <>
          <div className="border-t border-border px-2 py-2">
            <ToolsSidebarSection />
          </div>

          <div className="border-t border-border px-3 py-2">
            <FeedbackButton />
          </div>
        </>
      )}
    </div>
  );
}

function SyncIndicator({ sidebarCollapsed }: { sidebarCollapsed: boolean }) {
  const refetchingActions = useIsFetching({
    predicate: (query) =>
      query.queryKey[0] === "action" && query.state.dataUpdatedAt > 0,
  });
  const mutatingActions = useIsMutating();
  const [agentToolRuns, setAgentToolRuns] = useState(0);

  useEffect(() => {
    const trackedTools = new Set(["log-meal", "log-exercise", "log-weight"]);
    const handleStart = (event: Event) => {
      const tool = (event as CustomEvent).detail?.tool;
      if (trackedTools.has(tool)) setAgentToolRuns((count) => count + 1);
    };
    const handleDone = (event: Event) => {
      const tool = (event as CustomEvent).detail?.tool;
      if (!trackedTools.has(tool)) return;
      setTimeout(() => {
        setAgentToolRuns((count) => Math.max(0, count - 1));
      }, 400);
    };

    window.addEventListener("agent-native:tool-start", handleStart);
    window.addEventListener("agent-native:tool-done", handleDone);
    return () => {
      window.removeEventListener("agent-native:tool-start", handleStart);
      window.removeEventListener("agent-native:tool-done", handleDone);
    };
  }, []);

  const isSyncing =
    refetchingActions > 0 || mutatingActions > 0 || agentToolRuns > 0;

  if (!isSyncing) return null;

  return (
    <div
      className={cn(
        "pointer-events-none fixed bottom-10 left-4 z-50 flex h-8 items-center gap-2 rounded-full border border-white/[0.06] bg-muted/80 px-3 text-xs text-muted-foreground shadow-sm backdrop-blur-sm md:bottom-8",
        sidebarCollapsed
          ? "md:left-[calc(3.5rem+1rem)]"
          : "md:left-[calc(14rem+1rem)]",
      )}
    >
      <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
      Syncing…
    </div>
  );
}
