import { useState, useEffect, useCallback } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AgentSidebar,
  AgentToggleButton,
  getCallbackOrigin,
} from "@agent-native/core/client";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";
import { IconFlame } from "@tabler/icons-react";

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
      emptyStateText="Ask me about your nutrition, log meals by voice, or get insights"
      suggestions={[
        "What did I eat today?",
        "Log a chicken salad, 450 calories",
        "Show me my weight trend",
        "How many calories have I burned this week?",
      ]}
    >
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top nav */}
        <header className="sticky top-0 z-20 bg-background/80 backdrop-blur-md border-b border-white/[0.08] px-4 py-3">
          <div className="max-w-3xl lg:max-w-6xl mx-auto flex items-center justify-between">
            {/* Logo */}
            <span className="font-logo font-bold tracking-tight text-xl">
              <span className="text-foreground">nutri</span>
              <span className="text-foreground/50">track</span>
            </span>

            {/* Tab Navigation */}
            <nav className="absolute left-1/2 -translate-x-1/2 flex items-center p-1 rounded-lg bg-white/[0.02] border border-white/[0.06]">
              <Link to="/">
                <button
                  className={cn(
                    "px-4 py-1.5 text-sm font-medium rounded-md transition-all duration-200",
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
                    "px-4 py-1.5 text-sm font-medium rounded-md transition-all duration-200",
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
      </div>
    </AgentSidebar>
  );
}
