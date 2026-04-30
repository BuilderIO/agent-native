import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { agentNativePath } from "@agent-native/core/client";

export interface NavigationState {
  view: string;
  deckId?: string;
  slideIndex?: number;
}

export function useNavigationState() {
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();

  // Sync current route to application state
  useEffect(() => {
    const path = location.pathname;
    const state: NavigationState = { view: "list" };

    if (path.startsWith("/deck/")) {
      state.view = "editor";
      const match = path.match(/\/deck\/([^/]+)/);
      if (match) state.deckId = match[1];
      // Presentation mode
      if (path.endsWith("/present")) {
        state.view = "present";
      }
    } else if (path.startsWith("/settings")) {
      state.view = "settings";
    } else if (path.startsWith("/share/")) {
      state.view = "share";
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
      const res = await fetch(
        agentNativePath("/_agent-native/application-state/navigate"),
      );
      if (!res.ok) return null;
      const text = await res.text();
      if (!text) return null;
      try {
        const data = JSON.parse(text);
        if (data) {
          // Return with a timestamp to ensure uniqueness
          return { ...data, _ts: Date.now() };
        }
      } catch {
        // Empty or invalid JSON response — no navigate command
      }
      return null;
    },
    refetchInterval: 2_000,
    refetchIntervalInBackground: true,
    structuralSharing: false,
  });

  useEffect(() => {
    if (!navCommand) return;
    // Delete the one-shot command AFTER reading it
    fetch(agentNativePath("/_agent-native/application-state/navigate"), {
      method: "DELETE",
    }).catch(() => {});
    const cmd = navCommand as NavigationState;
    let path = "/";

    if (cmd.deckId) {
      path = `/deck/${cmd.deckId}`;
      if (cmd.view === "present") {
        path += "/present";
      }
    } else if (cmd.view === "settings") {
      path = "/settings";
    }

    navigate(path);
    qc.setQueryData(["navigate-command"], null);
  }, [navCommand, navigate, qc]);
}
