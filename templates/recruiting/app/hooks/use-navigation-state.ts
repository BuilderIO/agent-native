import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { NavigationState } from "@shared/types";

function resolveNavPath(cmd: NavigationState): string {
  if (cmd.view === "jobs") {
    return cmd.jobId ? `/jobs/${cmd.jobId}` : "/jobs";
  } else if (cmd.view === "candidates") {
    return cmd.candidateId ? `/candidates/${cmd.candidateId}` : "/candidates";
  } else if (cmd.view === "action-items") {
    return "/action-items";
  } else if (cmd.view === "interviews") {
    return "/interviews";
  } else if (cmd.view === "settings") {
    return "/settings";
  }
  return "/dashboard";
}

export function useNavigationState() {
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();

  // Sync current route to application state
  useEffect(() => {
    const path = location.pathname;
    const state: NavigationState = { view: "dashboard" };

    if (path === "/" || path.startsWith("/dashboard")) {
      state.view = "dashboard";
    } else if (path.startsWith("/jobs")) {
      state.view = "jobs";
      const match = path.match(/\/jobs\/(\d+)/);
      if (match) state.jobId = parseInt(match[1], 10);
    } else if (path.startsWith("/candidates")) {
      state.view = "candidates";
      const match = path.match(/\/candidates\/(\d+)/);
      if (match) state.candidateId = parseInt(match[1], 10);
    } else if (path.startsWith("/action-items")) {
      state.view = "action-items";
    } else if (path.startsWith("/interviews")) {
      state.view = "interviews";
    } else if (path === "/settings") {
      state.view = "settings";
    }

    fetch("/_agent-native/application-state/navigation", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    }).catch(() => {});
  }, [location.pathname]);

  // Listen for navigate commands from agent.
  // We use a unique queryKey with a counter to ensure each found command
  // produces a unique data value, preventing React Query from deduplicating.
  const { data: navCommand } = useQuery({
    queryKey: ["navigate-command"],
    queryFn: async () => {
      const res = await fetch("/_agent-native/application-state/navigate");
      if (!res.ok) return null;
      const data = await res.json();
      if (data && data.view) {
        // Delete the one-shot command immediately
        fetch("/_agent-native/application-state/navigate", {
          method: "DELETE",
        }).catch(() => {});
        // Return with a timestamp to ensure uniqueness
        return { ...data, _ts: Date.now() };
      }
      return null;
    },
    refetchInterval: 2_000,
    refetchIntervalInBackground: true,
    structuralSharing: false,
  });

  useEffect(() => {
    if (!navCommand) return;
    const cmd = navCommand as NavigationState;
    const path = resolveNavPath(cmd);

    navigate(path);
    qc.setQueryData(["navigate-command"], null);
  }, [navCommand, navigate, qc]);
}
