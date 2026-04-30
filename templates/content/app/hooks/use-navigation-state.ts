import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { agentNativePath } from "@agent-native/core/client";

interface NavigationState {
  view: string;
  documentId?: string;
}

/**
 * Syncs navigation state bidirectionally:
 * 1. Writes the current route to application state so the agent can read it
 * 2. Polls for navigate commands from the agent and applies them
 */
export function useNavigationState() {
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();

  // Write current route to application state
  useEffect(() => {
    const path = location.pathname;
    const state: NavigationState = { view: "list" };

    if (path === "/" || path === "") {
      state.view = "list";
    } else {
      // Document editor: /:id or /page/:id
      const pageMatch = path.match(/^\/page\/(.+)/);
      const directMatch = path.match(/^\/([a-f0-9]+)$/);
      if (pageMatch) {
        state.view = "editor";
        state.documentId = pageMatch[1];
      } else if (directMatch) {
        state.view = "editor";
        state.documentId = directMatch[1];
      }
    }

    fetch(agentNativePath("/_agent-native/application-state/navigation"), {
      method: "PUT",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    }).catch(() => {});
  }, [location.pathname]);

  // Poll for navigate commands from agent
  const { data: navCommand } = useQuery({
    queryKey: ["navigate-command"],
    queryFn: async () => {
      const res = await fetch(
        agentNativePath("/_agent-native/application-state/navigate"),
      );
      if (!res.ok) return null;
      const data = await res.json();
      if (data && data.path) {
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
    // Delete the one-shot command AFTER reading it
    fetch(agentNativePath("/_agent-native/application-state/navigate"), {
      method: "DELETE",
      headers: { "X-Agent-Native-CSRF": "1" },
    }).catch(() => {});

    navigate(navCommand.path);
    qc.setQueryData(["navigate-command"], null);
  }, [navCommand, navigate, qc]);
}
