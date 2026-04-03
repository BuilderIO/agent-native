import { useEffect, useCallback } from "react";
import { useLocation, useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";

interface NavigationState {
  view: string;
  dashboardId?: string;
}

export function useNavigationState() {
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();

  // Sync current route to application state
  useEffect(() => {
    const path = location.pathname;
    const state: NavigationState = { view: "overview" };

    if (path === "/" || path === "" || path === "/overview") {
      state.view = "overview";
    } else if (path.startsWith("/adhoc/")) {
      state.view = "adhoc";
      const match = path.match(/\/adhoc\/(.+)/);
      if (match) state.dashboardId = match[1];
    } else if (path === "/query") {
      state.view = "query";
    } else if (path === "/data-sources") {
      state.view = "data-sources";
    } else if (path === "/settings") {
      state.view = "settings";
    } else if (path === "/about") {
      state.view = "about";
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
    let path = "/";

    if (cmd.view === "adhoc" && cmd.dashboardId) {
      path = `/adhoc/${cmd.dashboardId}`;
    } else if (cmd.view === "query") {
      path = "/query";
    } else if (cmd.view === "data-sources") {
      path = "/data-sources";
    } else if (cmd.view === "settings") {
      path = "/settings";
    } else if (cmd.view === "overview") {
      path = "/overview";
    } else {
      path = "/";
    }

    navigate(path);
    qc.setQueryData(["navigate-command"], null);
  }, [navCommand, navigate, qc]);
}
