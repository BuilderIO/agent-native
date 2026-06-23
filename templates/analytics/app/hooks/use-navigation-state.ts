import {
  markAgentChatHomeHandoff,
  useAgentRouteState,
} from "@agent-native/core/client";
import { useLocation } from "react-router";
import { rememberLastOpened } from "@/lib/last-opened";
import { TAB_ID } from "@/lib/tab-id";

interface NavigationState {
  view: string;
  dashboardId?: string;
  analysisId?: string;
  extensionId?: string;
}

// URL query params (filters) are synced separately by the framework's <URLSync />
// under the `__url__` key, so the agent sees them in the <current-url> block.
export function useNavigationState() {
  const location = useLocation();
  useAgentRouteState<NavigationState>({
    browserTabId: TAB_ID,
    getNavigationState: ({ pathname }) => {
      const state: NavigationState = { view: "overview" };

      if (pathname === "/" || pathname === "" || pathname === "/overview") {
        state.view = "overview";
      } else if (pathname === "/ask") {
        state.view = "ask";
      } else if (pathname.startsWith("/adhoc/")) {
        state.view = "adhoc";
        const match = pathname.match(/\/adhoc\/(.+)/);
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
      } else if (pathname === "/data-sources") {
        state.view = "data-sources";
      } else if (pathname === "/data-dictionary") {
        state.view = "data-dictionary";
      } else if (pathname === "/catalog") {
        state.view = "catalog";
      } else if (pathname === "/settings") {
        state.view = "settings";
      } else if (pathname === "/about") {
        state.view = "about";
      }

      return state;
    },
    getCommandPath: (cmd) => {
      if (cmd.view === "adhoc" && cmd.dashboardId)
        return `/adhoc/${cmd.dashboardId}`;
      if (cmd.view === "analyses" && cmd.analysisId)
        return `/analyses/${cmd.analysisId}`;
      if (cmd.view === "analyses") return "/analyses";
      if (cmd.view === "extensions" && cmd.extensionId)
        return `/extensions/${cmd.extensionId}`;
      if (cmd.view === "extensions") return "/extensions";
      if (cmd.view === "data-sources") return "/data-sources";
      if (cmd.view === "data-dictionary") return "/data-dictionary";
      if (cmd.view === "catalog") return "/catalog";
      if (cmd.view === "ask") return "/ask";
      if (cmd.view === "settings") return "/settings";
      if (cmd.view === "overview") return "/overview";
      if (cmd.view === "about") return "/about";
      return "/";
    },
    onNavigate: (_command, path) => {
      if (location.pathname === "/ask" && pathnameFromPath(path) !== "/ask") {
        markAgentChatHomeHandoff("analytics");
      }
    },
  });
}

function pathnameFromPath(path: string): string {
  return path.split(/[?#]/, 1)[0] || "/";
}
