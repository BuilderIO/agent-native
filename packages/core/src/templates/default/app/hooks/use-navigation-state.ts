import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  agentNativePath,
  appBasePath,
  appPath,
} from "@agent-native/core/client";

export interface NavigationState {
  view: string;
  path?: string;
  /** Optional unique-per-write token. Used by the UI to dedup the same
   * command being re-read when the fire-and-forget DELETE below loses its
   * race against the next polling refetch. */
  _writeId?: string;
}

export function useNavigationState() {
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();

  useEffect(() => {
    const state: NavigationState = {
      view: viewFromPath(location.pathname),
      path: appPath(location.pathname),
    };

    fetch(agentNativePath("/_agent-native/application-state/navigation"), {
      method: "PUT",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    }).catch(() => {});
  }, [location.pathname]);

  // Default React Query structuralSharing reuses the previous reference when
  // the JSON is unchanged, so repeated invalidations driven by `useDbSync`
  // (which fire on every relevant app-state event) don't re-fire the
  // useEffect with a brand-new object containing the same command.
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
    const cmd = navCommand;
    const dedupKey =
      cmd._writeId ?? JSON.stringify({ view: cmd.view, path: cmd.path });
    if (lastProcessedDedupKeyRef.current === dedupKey) {
      // Same command we already handled — the consume-DELETE races against
      // the next polling refetch, so when it loses the same command can show
      // up again. Re-fire DELETE and bail rather than navigate again.
      fetch(agentNativePath("/_agent-native/application-state/navigate"), {
        method: "DELETE",
        headers: { "X-Agent-Native-CSRF": "1" },
      }).catch(() => {});
      qc.setQueryData(["navigate-command"], null);
      return;
    }
    lastProcessedDedupKeyRef.current = dedupKey;

    fetch(agentNativePath("/_agent-native/application-state/navigate"), {
      method: "DELETE",
      headers: { "X-Agent-Native-CSRF": "1" },
    }).catch(() => {});

    const path = routerPath(cmd.path || pathFromView(cmd.view));
    navigate(path);
    qc.setQueryData(["navigate-command"], null);
  }, [navCommand, navigate, qc]);
}

function viewFromPath(pathname: string): string {
  if (!pathname || pathname === "/") return "home";
  return pathname.replace(/^\/+/, "") || "home";
}

function pathFromView(view: string | undefined): string {
  if (!view || view === "home") return "/";
  return `/${view.replace(/^\/+/, "")}`;
}

function routerPath(path: string): string {
  const basePath = appBasePath();
  if (!basePath) return path;
  if (path === basePath) return "/";
  if (path.startsWith(`${basePath}/`)) {
    return path.slice(basePath.length) || "/";
  }
  return path;
}
