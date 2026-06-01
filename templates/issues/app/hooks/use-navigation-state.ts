import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { agentNativePath } from "@agent-native/core/client";
import type { NavigationState } from "@shared/types";

export function useNavigationState() {
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();

  // Sync current route to application state
  useEffect(() => {
    const path = location.pathname;
    const state: NavigationState = { view: "my-issues" };

    if (path.startsWith("/my-issues")) {
      state.view = "my-issues";
      const match = path.match(/\/my-issues\/(.+)/);
      if (match) state.issueKey = match[1];
    } else if (path.startsWith("/projects")) {
      state.view = "projects";
      const match = path.match(/\/projects\/([^/]+)/);
      if (match) state.projectKey = match[1];
      const issueMatch = path.match(/\/projects\/[^/]+\/(.+)/);
      if (issueMatch) state.issueKey = issueMatch[1];
    } else if (path.startsWith("/board")) {
      state.view = "board";
      const match = path.match(/\/board\/([^/]+)/);
      if (match) state.boardId = match[1];
      const issueMatch = path.match(/\/board\/[^/]+\/(.+)/);
      if (issueMatch) state.issueKey = issueMatch[1];
    } else if (path.startsWith("/sprint")) {
      state.view = "sprint";
      const match = path.match(/\/sprint\/([^/]+)/);
      if (match) state.boardId = match[1];
      const issueMatch = path.match(/\/sprint\/[^/]+\/(.+)/);
      if (issueMatch) state.issueKey = issueMatch[1];
    } else if (path === "/settings") {
      state.view = "settings";
    }

    fetch(agentNativePath("/_agent-native/application-state/navigation"), {
      method: "PUT",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    }).catch(() => {});
  }, [location.pathname]);

  // Default React Query structuralSharing reuses the previous reference when the
  // JSON is unchanged, so repeated polling/invalidations don't re-fire the
  // effect with a new object carrying the same command.
  const { data: navCommand } = useQuery<NavigationState | null>({
    queryKey: ["navigate-command"],
    queryFn: async () => {
      const res = await fetch(
        agentNativePath("/_agent-native/application-state/navigate"),
      );
      if (!res.ok) return null;
      const data = await res.json();
      return data ?? null;
    },
    refetchInterval: 2_000,
  });

  const lastProcessedDedupKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!navCommand) return;
    const cmd = navCommand as NavigationState;
    const dedupKey = JSON.stringify({
      view: cmd.view,
      issueKey: cmd.issueKey,
      projectKey: cmd.projectKey,
      boardId: cmd.boardId,
      sprintId: cmd.sprintId,
    });
    if (lastProcessedDedupKeyRef.current === dedupKey) {
      // Same command we already handled — the consume-DELETE races against the
      // next polling refetch, so when it loses the command can reappear. Re-fire
      // DELETE and bail rather than navigate again.
      fetch(agentNativePath("/_agent-native/application-state/navigate"), {
        method: "DELETE",
        headers: { "X-Agent-Native-CSRF": "1" },
      }).catch(() => {});
      qc.setQueryData(["navigate-command"], null);
      return;
    }
    lastProcessedDedupKeyRef.current = dedupKey;

    // Delete the one-shot command AFTER reading it
    fetch(agentNativePath("/_agent-native/application-state/navigate"), {
      method: "DELETE",
      headers: { "X-Agent-Native-CSRF": "1" },
    }).catch(() => {});
    let path = "/my-issues";

    if (cmd.view === "projects" && cmd.projectKey) {
      path = `/projects/${cmd.projectKey}`;
      if (cmd.issueKey) path += `/${cmd.issueKey}`;
    } else if (cmd.view === "board" && cmd.boardId) {
      path = `/board/${cmd.boardId}`;
      if (cmd.issueKey) path += `/${cmd.issueKey}`;
    } else if (cmd.view === "sprint" && cmd.boardId) {
      path = `/sprint/${cmd.boardId}`;
      if (cmd.issueKey) path += `/${cmd.issueKey}`;
    } else if (cmd.view === "my-issues") {
      path = "/my-issues";
      if (cmd.issueKey) path += `/${cmd.issueKey}`;
    } else if (cmd.view === "settings") {
      path = "/settings";
    }

    navigate(path);
    qc.setQueryData(["navigate-command"], null);
  }, [navCommand, navigate, qc]);
}
