import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { NavigationState } from "@shared/types";

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
    } else if (path.startsWith("/interviews")) {
      state.view = "interviews";
    } else if (path === "/settings") {
      state.view = "settings";
    }

    fetch("/api/application-state/navigation", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    }).catch(() => {});
  }, [location.pathname]);

  // Listen for navigate commands from agent
  const { data: navCommand } = useQuery({
    queryKey: ["navigate-command"],
    queryFn: async () => {
      const res = await fetch("/api/application-state/navigate");
      if (!res.ok) return null;
      const data = await res.json();
      if (data) {
        // Delete the one-shot command
        fetch("/api/application-state/navigate", { method: "DELETE" }).catch(
          () => {},
        );
        return data;
      }
      return null;
    },
    refetchInterval: 5_000,
  });

  useEffect(() => {
    if (!navCommand) return;
    const cmd = navCommand as NavigationState;
    let path = "/dashboard";

    if (cmd.view === "dashboard") {
      path = "/dashboard";
    } else if (cmd.view === "jobs") {
      path = cmd.jobId ? `/jobs/${cmd.jobId}` : "/jobs";
    } else if (cmd.view === "candidates") {
      path = cmd.candidateId ? `/candidates/${cmd.candidateId}` : "/candidates";
    } else if (cmd.view === "interviews") {
      path = "/interviews";
    } else if (cmd.view === "settings") {
      path = "/settings";
    }

    navigate(path);
    qc.setQueryData(["navigate-command"], null);
  }, [navCommand, navigate, qc]);
}
