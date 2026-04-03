import { useEffect } from "react";
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

    fetch("/_agent-native/application-state/navigation", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    }).catch(() => {});
  }, [location.pathname]);

  // Listen for navigate commands from agent
  const { data: navCommand } = useQuery({
    queryKey: ["navigate-command"],
    queryFn: async () => {
      try {
        const res = await fetch("/_agent-native/application-state/navigate");
        if (!res.ok || res.status === 204) return null;
        const text = await res.text();
        if (!text) return null;
        const data = JSON.parse(text);
        if (data) {
          // Return with a timestamp to ensure uniqueness
          return { ...data, _ts: Date.now() };
        }
      } catch (_e) {
        // Network error, JSON parse error, etc. — ignore and retry next poll
      }
      return null;
    },
    refetchInterval: 2_000,
    refetchIntervalInBackground: true,
    structuralSharing: false,
    retry: false,
  });

  useEffect(() => {
    if (!navCommand) return;
    // Delete the one-shot command AFTER reading it
    fetch("/_agent-native/application-state/navigate", {
      method: "DELETE",
    }).catch(() => {});
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
    } else if (cmd.view === "about") {
      path = "/about";
    } else {
      path = "/";
    }

    navigate(path);
    qc.setQueryData(["navigate-command"], null);
  }, [navCommand, navigate, qc]);
}
