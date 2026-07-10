import {
  markAgentChatHomeHandoff,
  useAgentRouteState,
} from "@agent-native/core/client";
import { useLocation } from "react-router";

import {
  ANALYTICS_CHAT_STORAGE_KEY,
  hasRecentAnalyticsChat,
} from "@/lib/chat-handoff";
import { rememberLastOpened } from "@/lib/last-opened";
import { TAB_ID } from "@/lib/tab-id";

interface NavigationState {
  view: string;
  dashboardId?: string;
  analysisId?: string;
  extensionId?: string;
  recordingId?: string;
  agentsView?: string;
  dbAdminConnectionId?: string;
  monitoringView?: string;
  monitorId?: string;
  statusPageId?: string;
  errorIssueId?: string;
  filters?: Record<string, string>;
}

const SESSION_FILTER_KEYS = ["range", "app", "q"] as const;

export function useNavigationState() {
  const location = useLocation();
  useAgentRouteState<NavigationState>({
    browserTabId: TAB_ID,
    getNavigationState: ({ pathname, searchParams }) => {
      const state: NavigationState = { view: "ask" };

      if (pathname === "/" || pathname === "" || pathname === "/overview") {
        state.view = "ask";
      } else if (pathname === "/ask") {
        state.view = "ask";
      } else if (
        pathname.startsWith("/dashboards/") ||
        pathname.startsWith("/adhoc/")
      ) {
        state.view = "adhoc";
        const match = pathname.match(/\/(?:adhoc|dashboards)\/(.+)/);
        if (match) {
          state.dashboardId = match[1];
          localStorage.setItem("last-dashboard-id", match[1]);
          rememberLastOpened("dashboard", match[1], pathname);
        }
      } else if (pathname === "/analyses") {
        state.view = "analyses";
      } else if (pathname.startsWith("/analyses/")) {
        state.view = "analyses";
        const match = pathname.match(/\/analyses\/(.+)/);
        if (match) {
          state.analysisId = match[1];
          rememberLastOpened("analysis", match[1], pathname);
        }
      } else if (pathname === "/extensions") {
        state.view = "extensions";
      } else if (pathname.startsWith("/extensions/")) {
        state.view = "extensions";
        const match = pathname.match(/\/extensions\/([^/]+)/);
        if (match && match[1] !== "new") {
          state.extensionId = match[1];
          rememberLastOpened("extension", match[1], pathname);
        }
      } else if (pathname === "/sessions") {
        state.view = "sessions";
        state.filters = sessionFilters(searchParams);
      } else if (pathname.startsWith("/sessions/")) {
        state.view = "sessions";
        const match = pathname.match(/\/sessions\/([^/]+)/);
        if (match) {
          state.recordingId = decodeURIComponent(match[1]);
        }
        state.filters = sessionFilters(searchParams);
      } else if (pathname === "/agents") {
        state.view = "agents";
        state.agentsView = searchParams.get("view") || "monitoring";
        if (state.agentsView === "database") {
          const dbAdminConnectionId = searchParams.get("db");
          if (dbAdminConnectionId)
            state.dbAdminConnectionId = dbAdminConnectionId;
        }
      } else if (pathname === "/monitoring") {
        state.view = "monitoring";
        state.monitoringView =
          searchParams.get("view") === "errors" ? "errors" : "uptime";
        if (state.monitoringView === "errors") {
          const issue = searchParams.get("issue");
          if (issue) state.errorIssueId = issue;
        } else {
          const statusPage = searchParams.get("statuspage");
          if (statusPage) {
            // "list" | "new" | <id> - the status-pages config sub-view.
            state.statusPageId = statusPage;
          } else {
            const monitor = searchParams.get("monitor");
            if (monitor) state.monitorId = monitor;
          }
        }
      } else if (pathname === "/data-sources") {
        state.view = "data-sources";
      } else if (pathname === "/data-dictionary") {
        state.view = "data-dictionary";
      } else if (pathname === "/catalog") {
        state.view = "catalog";
      } else if (pathname === "/settings") {
        state.view = "settings";
      }

      return state;
    },
    getCommandPath: (cmd) => {
      if (cmd.view === "adhoc" && cmd.dashboardId)
        return `/dashboards/${cmd.dashboardId}`;
      if (cmd.view === "analyses" && cmd.analysisId)
        return `/analyses/${cmd.analysisId}`;
      if (cmd.view === "analyses") return "/analyses";
      if (cmd.view === "extensions" && cmd.extensionId)
        return `/extensions/${cmd.extensionId}`;
      if (cmd.view === "extensions") return "/extensions";
      if (cmd.view === "sessions" && cmd.recordingId)
        return `/sessions/${encodeURIComponent(cmd.recordingId)}`;
      if (cmd.view === "sessions") return "/sessions";
      if (
        cmd.view === "agents" &&
        (cmd.agentsView === "database" || cmd.agentsView === "dashboards")
      ) {
        const params = new URLSearchParams({ view: cmd.agentsView });
        if (cmd.agentsView === "database" && cmd.dbAdminConnectionId) {
          params.set("db", cmd.dbAdminConnectionId);
        }
        return `/agents?${params.toString()}`;
      }
      if (cmd.view === "agents") return "/agents";
      if (cmd.view === "monitoring") {
        const params = new URLSearchParams();
        if (cmd.monitoringView === "errors") {
          params.set("view", "errors");
          if (cmd.errorIssueId) params.set("issue", cmd.errorIssueId);
        } else if (cmd.statusPageId) {
          params.set("statuspage", cmd.statusPageId);
        } else if (cmd.monitorId) {
          params.set("monitor", cmd.monitorId);
        }
        const qs = params.toString();
        return qs ? `/monitoring?${qs}` : "/monitoring";
      }
      if (cmd.view === "data-sources") return "/data-sources";
      if (cmd.view === "data-dictionary") return "/data-dictionary";
      if (cmd.view === "catalog") return "/catalog";
      if (cmd.view === "ask") return "/ask";
      if (cmd.view === "settings") return "/settings";
      if (cmd.view === "overview" || cmd.view === "home") return "/ask";
      return "/";
    },
    onNavigate: (_command, path) => {
      if (location.pathname === "/ask" && pathnameFromPath(path) !== "/ask") {
        if (hasRecentAnalyticsChat()) {
          markAgentChatHomeHandoff(ANALYTICS_CHAT_STORAGE_KEY);
        }
      }
    },
  });
}

function pathnameFromPath(path: string): string {
  return path.split(/[?#]/, 1)[0] || "/";
}

function sessionFilters(
  searchParams?: URLSearchParams | Record<string, string>,
): Record<string, string> | undefined {
  const filters: Record<string, string> = {};
  for (const key of SESSION_FILTER_KEYS) {
    const value =
      searchParams instanceof URLSearchParams
        ? searchParams.get(key)
        : searchParams?.[key];
    if (value) filters[key] = value;
  }
  return Object.keys(filters).length > 0 ? filters : undefined;
}
