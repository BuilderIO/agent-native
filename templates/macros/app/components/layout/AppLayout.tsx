import { AgentSidebar } from "@agent-native/core/client/agent-chat";
import { agentNativePath } from "@agent-native/core/client/api-path";
import { DevDatabaseLink } from "@agent-native/core/client/db-admin";
import { useT } from "@agent-native/core/client/i18n";
import { openCommandMenu } from "@agent-native/core/client/navigation";
import { OrgSwitcher } from "@agent-native/core/client/org";
import {
  AppSidebar,
  FeedbackButton,
  type AppSidebarItemDefinition,
} from "@agent-native/core/client/ui";
import { HeaderActionsProvider } from "@agent-native/toolkit/app-shell";
import {
  IconChartBar,
  IconFlame,
  IconLoader2,
  IconSearch,
  IconSettings,
} from "@tabler/icons-react";
import {
  useIsFetching,
  useIsMutating,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { apiFetch } from "@/lib/api";
import { TAB_ID } from "@/lib/tab-id";
import { cn } from "@/lib/utils";

import { Header } from "./Header";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const t = useT();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("macros:left-sidebar-collapsed") === "1";
  });

  const isAnalytics = location.pathname === "/analytics";
  const isSettings = location.pathname.startsWith("/settings");
  const isAgent =
    location.pathname.startsWith("/settings/agent") ||
    location.pathname.startsWith("/agent");

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
    const view = isAgent
      ? "agent"
      : isSettings
        ? "settings"
        : isAnalytics
          ? "analytics"
          : "entry";
    apiFetch(`/_agent-native/application-state/navigation:${TAB_ID}`, {
      method: "PUT",
      body: JSON.stringify({ view, path: location.pathname }),
    }).catch(() => {});
  }, [location.pathname, isAgent, isAnalytics, isSettings]);

  // useDbSync invalidates this key when the agent writes a navigate command.
  const { data: navCommand } = useQuery({
    queryKey: ["navigate-command", TAB_ID],
    queryFn: async () => {
      try {
        const res = await fetch(
          agentNativePath(
            `/_agent-native/application-state/navigate:${TAB_ID}`,
          ),
        );
        if (!res.ok) return null;
        return await res.json();
      } catch {
        return null;
      }
    },
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
        void navigate("/analytics");
      } else if (cmd.view === "settings") {
        void navigate("/settings");
      } else if (cmd.view === "agent") {
        void navigate("/settings/agent");
      } else if (cmd.view === "entry") {
        void navigate("/home");
      }
      // Clear the command
      fetch(
        agentNativePath(`/_agent-native/application-state/navigate:${TAB_ID}`),
        {
          method: "DELETE",
        },
      ).catch(() => {});
      queryClient.setQueryData(["navigate-command", TAB_ID], null);
    }
  }, [navCommand, navigate, queryClient]);

  return (
    <HeaderActionsProvider>
      <AgentSidebar
        position="right"
        defaultOpen={false}
        animateMobile
        emptyStateText={t("agent.emptyState")}
        suggestions={[
          t("agent.suggestionLunch"),
          t("agent.suggestionMacros"),
          t("agent.suggestionRun"),
        ]}
        agentPageHref="/settings/agent"
      >
        <div className="agent-layout-shell flex flex-1 overflow-hidden">
          {/* Desktop sidebar */}
          <div className="hidden md:flex h-full">
            <SidebarContent
              pathname={location.pathname}
              collapsed={desktopSidebarCollapsed}
              onToggleCollapsed={() =>
                setDesktopSidebarCollapsed((collapsed) => !collapsed)
              }
            />
          </div>

          {/* Mobile sidebar sheet */}
          <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
            <SheetContent side="left" className="w-[260px] p-0">
              <SheetTitle className="sr-only">
                {t("sidebar.navigation")}
              </SheetTitle>
              <SidebarContent pathname={location.pathname} />
            </SheetContent>
          </Sheet>

          {/* Page content */}
          <div className="agent-layout-main-surface flex min-w-0 flex-1 flex-col overflow-hidden">
            <Header onOpenSidebar={() => setSidebarOpen(true)} />
            <main className="agent-native-app-main min-w-0 flex-1 overflow-y-auto">
              {children}
            </main>
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
  const t = useT();

  const items: AppSidebarItemDefinition[] = [
    {
      to: "/home",
      label: t("navigation.entry"),
      icon: IconFlame,
      active: pathname === "/home" || pathname === "/entry",
    },
    {
      to: "/analytics",
      label: t("navigation.analytics"),
      icon: IconChartBar,
      active: pathname.startsWith("/analytics"),
    },
  ];

  const secondaryItems: AppSidebarItemDefinition[] = [
    {
      to: "/settings",
      label: t("navigation.settings"),
      icon: IconSettings,
      active: pathname.startsWith("/settings"),
    },
  ];

  const feedbackButton = (
    <FeedbackButton variant={collapsed ? "icon" : "sidebar"} side="right" />
  );

  const orgSwitcher = <OrgSwitcher compact={collapsed} />;

  const searchButton = (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-9 shrink-0 text-primary hover:bg-accent/60 hover:text-primary"
          onClick={openCommandMenu}
          aria-label={t("sidebar.search")}
        >
          <IconSearch className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">{t("sidebar.search")}</TooltipContent>
    </Tooltip>
  );

  return (
    <AppSidebar
      collapsed={collapsed}
      collapsible={Boolean(onToggleCollapsed)}
      onCollapsedChange={onToggleCollapsed}
      brandName={t("navigation.brand")}
      brandHref="/home"
      items={items}
      secondaryItems={secondaryItems}
      feedback={feedbackButton}
      orgSwitcher={orgSwitcher}
      footerExtras={
        <>
          {searchButton}
          <DevDatabaseLink />
        </>
      }
    />
  );
}

function SyncIndicator({ sidebarCollapsed }: { sidebarCollapsed: boolean }) {
  const t = useT();
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
        "pointer-events-none fixed bottom-10 start-4 z-50 flex h-8 items-center gap-2 rounded-full border border-border bg-muted/80 px-3 text-xs text-muted-foreground shadow-sm backdrop-blur-sm md:bottom-8",
        sidebarCollapsed
          ? "md:start-[calc(3.5rem+1rem)]"
          : "md:start-[calc(14rem+1rem)]",
      )}
    >
      <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
      {t("sidebar.syncing")}
    </div>
  );
}
