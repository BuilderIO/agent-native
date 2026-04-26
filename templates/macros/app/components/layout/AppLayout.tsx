import { useState, useEffect, useCallback } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useIsFetching, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AgentSidebar,
  AgentToggleButton,
  getCallbackOrigin,
} from "@agent-native/core/client";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";
import { IconFlame, IconLoader2 } from "@tabler/icons-react";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const isEntry = location.pathname === "/" || location.pathname === "/entry";
  const isAnalytics = location.pathname === "/analytics";

  // Navigation state sync - write current view to application state
  useEffect(() => {
    const view = isAnalytics ? "analytics" : "entry";
    apiFetch("/_agent-native/application-state/navigation", {
      method: "PUT",
      body: JSON.stringify({ view, path: location.pathname }),
    }).catch(() => {});
  }, [location.pathname, isAnalytics]);

  // Poll for navigate commands from the agent
  const { data: navCommand } = useQuery({
    queryKey: ["navigate-command"],
    queryFn: async () => {
      try {
        const res = await fetch("/_agent-native/application-state/navigate");
        if (!res.ok) return null;
        return await res.json();
      } catch {
        return null;
      }
    },
    refetchInterval: 2000,
  });

  useEffect(() => {
    if (navCommand?.value) {
      const cmd =
        typeof navCommand.value === "string"
          ? JSON.parse(navCommand.value)
          : navCommand.value;
      if (cmd.view === "analytics") {
        navigate("/analytics");
      } else if (cmd.view === "entry") {
        navigate("/");
      }
      // Clear the command
      fetch("/_agent-native/application-state/navigate", {
        method: "DELETE",
      }).catch(() => {});
      queryClient.setQueryData(["navigate-command"], null);
    }
  }, [navCommand, navigate, queryClient]);

  return (
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
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top nav */}
        <header className="sticky top-0 z-20 bg-background/80 backdrop-blur-md border-b border-white/[0.08] px-3 sm:px-4 py-2.5 sm:py-3">
          <div className="max-w-3xl lg:max-w-6xl mx-auto flex items-center justify-between gap-2">
            {/* Logo */}
            <span className="font-logo font-bold tracking-tight text-lg sm:text-xl text-foreground">
              macros
            </span>

            {/* Tab Navigation */}
            <nav className="flex items-center p-1 rounded-lg bg-white/[0.02] border border-white/[0.06]">
              <Link to="/">
                <button
                  className={cn(
                    "px-3 py-1.5 text-sm font-medium rounded-md sm:px-4",
                    isEntry
                      ? "text-foreground bg-white/[0.08] shadow-sm"
                      : "text-muted-foreground hover:text-foreground hover:bg-white/[0.02]",
                  )}
                >
                  Entry
                </button>
              </Link>
              <Link to="/analytics">
                <button
                  className={cn(
                    "px-3 py-1.5 text-sm font-medium rounded-md sm:px-4",
                    isAnalytics
                      ? "text-foreground bg-white/[0.08] shadow-sm"
                      : "text-muted-foreground hover:text-foreground hover:bg-white/[0.02]",
                  )}
                >
                  Analytics
                </button>
              </Link>
            </nav>

            {/* Agent toggle */}
            <AgentToggleButton />
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">{children}</main>
        <SyncIndicator />
      </div>
    </AgentSidebar>
  );
}

function SyncIndicator() {
  const isFetching = useIsFetching({ queryKey: ["action"] });
  if (!isFetching) return null;
  return (
    <div className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-full bg-muted/80 backdrop-blur-sm px-3 py-1.5 text-xs text-muted-foreground shadow-sm border border-white/[0.06]">
      <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
      Syncing…
    </div>
  );
}
