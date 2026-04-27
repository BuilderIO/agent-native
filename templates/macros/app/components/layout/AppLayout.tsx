import { useState, useEffect, useCallback } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import {
  useIsFetching,
  useIsMutating,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  AgentSidebar,
  AgentToggleButton,
  getCallbackOrigin,
} from "@agent-native/core/client";
import { ToolsSidebarSection } from "@agent-native/core/client/tools";
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

            <ToolsSidebarSection />

            {/* Agent toggle */}
            <AgentToggleButton />
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">{children}</main>
        <AgentActionOptimisticUpdates />
        <SyncIndicator />
      </div>
    </AgentSidebar>
  );
}

function SyncIndicator() {
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
    <div className="fixed bottom-10 md:bottom-8 left-4 z-50 flex h-8 items-center gap-2 rounded-full bg-muted/80 backdrop-blur-sm px-3 text-xs text-muted-foreground shadow-sm border border-white/[0.06]">
      <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
      Syncing…
    </div>
  );
}

function AgentActionOptimisticUpdates() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const normalizeDate = (value: unknown) => {
      if (typeof value === "string" && value.trim()) {
        return value.split("T")[0];
      }
      const today = new Date();
      const year = today.getFullYear();
      const month = String(today.getMonth() + 1).padStart(2, "0");
      const day = String(today.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    };

    const updateList = (
      listAction: string,
      date: string,
      optimisticId: number,
      item: Record<string, unknown>,
    ) => {
      queryClient.setQueriesData(
        {
          predicate: (query) => {
            const [prefix, actionName, params] = query.queryKey;
            return (
              prefix === "action" &&
              actionName === listAction &&
              (!params ||
                typeof params !== "object" ||
                (params as { date?: string }).date === date)
            );
          },
        },
        (oldData: unknown) => {
          if (!Array.isArray(oldData)) return oldData;
          if (
            oldData.some(
              (existing) =>
                existing &&
                typeof existing === "object" &&
                (existing as { id?: unknown }).id === optimisticId,
            )
          ) {
            return oldData;
          }
          return [item, ...oldData];
        },
      );
    };

    const handleToolStart = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { tool?: string; input?: Record<string, unknown> }
        | undefined;
      const tool = detail?.tool;
      const input = detail?.input ?? {};
      const date = normalizeDate(input.date);
      const optimisticId = -Date.now();
      const created_at = new Date().toISOString();

      if (tool === "log-meal") {
        updateList("list-meals", date, optimisticId, {
          id: optimisticId,
          name: String(input.name || "Meal"),
          calories: Number(input.calories || 0),
          protein: input.protein == null ? null : Number(input.protein),
          carbs: input.carbs == null ? null : Number(input.carbs),
          fat: input.fat == null ? null : Number(input.fat),
          date,
          image_url: null,
          notes: null,
          created_at,
        });
      } else if (tool === "log-exercise") {
        updateList("list-exercises", date, optimisticId, {
          id: optimisticId,
          name: String(input.name || "Exercise"),
          calories_burned: Number(input.calories_burned || 0),
          duration_minutes:
            input.duration_minutes == null
              ? null
              : Number(input.duration_minutes),
          date,
          created_at,
        });
      } else if (tool === "log-weight" && input.weight != null) {
        updateList("list-weights", date, optimisticId, {
          id: optimisticId,
          weight: Number(input.weight),
          date,
          notes: input.notes == null ? null : String(input.notes),
          created_at,
        });
      }
    };

    window.addEventListener("agent-native:tool-start", handleToolStart);
    return () =>
      window.removeEventListener("agent-native:tool-start", handleToolStart);
  }, [queryClient]);

  return null;
}
