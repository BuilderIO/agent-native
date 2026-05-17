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

  // Poll for navigate commands from agent.
  //
  // Two shapes arrive here:
  //  - `{ path }` — the `navigate` action's explicit path form.
  //  - `{ view, documentId }` — the deep-link / `/_agent-native/open` form
  //    (the open route writes the non-reserved params + view, never a `path`).
  // Resolve either into a router path: `view: "editor"` + `documentId` maps to
  // `/page/<id>`, `view: "list"` maps to `/`.
  const { data: navCommand } = useQuery({
    queryKey: ["navigate-command"],
    queryFn: async () => {
      const res = await fetch(
        agentNativePath("/_agent-native/application-state/navigate"),
      );
      if (!res.ok) return null;
      const data = await res.json();
      if (data && (data.path || data.view || data.documentId)) {
        // Return with a timestamp to ensure uniqueness
        return { ...data, _ts: Date.now() };
      }
      return null;
    },
    refetchInterval: 2_000,
    structuralSharing: false,
  });

  useEffect(() => {
    if (!navCommand) return;
    // Delete the one-shot command AFTER reading it
    fetch(agentNativePath("/_agent-native/application-state/navigate"), {
      method: "DELETE",
      headers: { "X-Agent-Native-CSRF": "1" },
    }).catch(() => {});

    const target = resolveNavTarget(navCommand);
    if (target) navigate(target, { flushSync: true });
    qc.setQueryData(["navigate-command"], null);
  }, [navCommand, navigate, qc]);
}

/**
 * Resolve a navigate command (explicit `path`, or deep-link `view` +
 * `documentId`) into a client-side router path.
 */
function resolveNavTarget(cmd: {
  path?: string;
  view?: string;
  documentId?: string;
}): string | null {
  if (cmd.path) return cmd.path;
  if (cmd.documentId) return `/page/${cmd.documentId}`;
  if (cmd.view === "list") return "/";
  return null;
}
