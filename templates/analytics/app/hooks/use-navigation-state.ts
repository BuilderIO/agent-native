import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { agentNativePath } from "@agent-native/core/client";

interface NavigationState {
  view: string;
  dashboardId?: string;
  analysisId?: string;
}

export function useNavigationState() {
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();

  // Sync current route to application state. URL query params (filters)
  // are synced separately by the framework's <URLSync /> under the
  // `__url__` key, so the agent sees them in the <current-url> block.
  useEffect(() => {
    const path = location.pathname;
    const state: NavigationState = { view: "overview" };

    if (path === "/" || path === "" || path === "/overview") {
      state.view = "overview";
    } else if (path.startsWith("/adhoc/")) {
      state.view = "adhoc";
      const match = path.match(/\/adhoc\/(.+)/);
      if (match) {
        state.dashboardId = match[1];
        localStorage.setItem("last-dashboard-id", match[1]);
      }
    } else if (path === "/analyses") {
      state.view = "analyses";
    } else if (path.startsWith("/analyses/")) {
      state.view = "analyses";
      const match = path.match(/\/analyses\/(.+)/);
      if (match) state.analysisId = match[1];
    } else if (path === "/data-sources") {
      state.view = "data-sources";
    } else if (path === "/data-dictionary") {
      state.view = "data-dictionary";
    } else if (path === "/settings") {
      state.view = "settings";
    } else if (path === "/about") {
      state.view = "about";
    }

    fetch(agentNativePath("/_agent-native/application-state/navigation"), {
      method: "PUT",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    }).catch(() => {});
  }, [location.pathname]);

  // Listen for navigate commands from agent
  const { data: navCommand } = useQuery({
    queryKey: ["navigate-command"],
    queryFn: async () => {
      try {
        const res = await fetch(
          agentNativePath("/_agent-native/application-state/navigate"),
        );
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
    fetch(agentNativePath("/_agent-native/application-state/navigate"), {
      method: "DELETE",
      headers: { "X-Agent-Native-CSRF": "1" },
    }).catch(() => {});
    const cmd = navCommand as NavigationState;
    let path = "/";

    if (cmd.view === "adhoc" && cmd.dashboardId) {
      path = `/adhoc/${cmd.dashboardId}`;
    } else if (cmd.view === "analyses" && cmd.analysisId) {
      path = `/analyses/${cmd.analysisId}`;
    } else if (cmd.view === "analyses") {
      path = "/analyses";
    } else if (cmd.view === "data-sources") {
      path = "/data-sources";
    } else if (cmd.view === "data-dictionary") {
      path = "/data-dictionary";
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
