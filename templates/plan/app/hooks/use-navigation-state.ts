import {
  agentNativePath,
  appBasePath,
  markAgentChatHomeHandoff,
} from "@agent-native/core/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router";

import { prewarmPlanRoutePath } from "@/lib/route-prewarm";
import { TAB_ID } from "@/lib/tab-id";

export interface NavigationState {
  view: string;
  planId?: string;
  localPlanSlug?: string;
  localPlanPath?: string;
  path?: string;
  _writeId?: string;
}

export function useNavigationState() {
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const lastProcessedDedupKeyRef = useRef<string | null>(null);

  // Sync current route to application state
  useEffect(() => {
    const state: NavigationState = {
      view: viewForPath(location.pathname),
    };
    const localPlanMatch = location.pathname.match(/^\/local-plans\/([^/]+)/);
    const planMatch =
      location.pathname.match(/^\/plans\/([^/]+)/) ??
      location.pathname.match(/^\/recaps\/([^/]+)/);
    if (localPlanMatch) {
      const slug = decodeURIComponent(localPlanMatch[1] ?? "");
      state.planId = `local-${slug}`;
      state.localPlanSlug = slug;
      const localPath = new URLSearchParams(location.search).get("path");
      if (localPath) state.localPlanPath = localPath;
    } else if (planMatch) {
      state.planId = decodeURIComponent(planMatch[1] ?? "");
    }

    fetch(agentNativePath("/_agent-native/application-state/navigation"), {
      method: "PUT",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        "X-Request-Source": TAB_ID,
      },
      body: JSON.stringify(state),
    }).catch(() => {});
  }, [location.pathname, location.search]);

  // Listen for one-shot navigate commands from the agent. useDbSync
  // invalidates this exact key when the shared SSE/poll transport receives an
  // app-state:navigate event, so this stays idle between real commands instead
  // of charging the host for a request every two seconds.
  const { data: navCommand } = useQuery({
    queryKey: ["navigate-command"],
    queryFn: async () => {
      const res = await fetch(
        agentNativePath("/_agent-native/application-state/navigate"),
      );
      if (!res.ok) return null;
      const data = await res.json();
      if (data) {
        // Return with a timestamp to ensure uniqueness
        return { ...data, _ts: Date.now() };
      }
      return null;
    },
    retry: false,
    structuralSharing: false,
  });

  useEffect(() => {
    if (!navCommand) return;
    const cmd = navCommand as NavigationState;
    const dedupKey =
      cmd._writeId ??
      JSON.stringify({
        view: cmd.view,
        planId: cmd.planId,
        localPlanSlug: cmd.localPlanSlug,
        localPlanPath: cmd.localPlanPath,
      });
    const deleteCommand = () =>
      fetch(agentNativePath("/_agent-native/application-state/navigate"), {
        method: "DELETE",
        headers: {
          "X-Agent-Native-CSRF": "1",
          "X-Request-Source": TAB_ID,
        },
      }).catch(() => {});

    if (lastProcessedDedupKeyRef.current === dedupKey) {
      deleteCommand();
      qc.setQueryData(["navigate-command"], null);
      return;
    }
    lastProcessedDedupKeyRef.current = dedupKey;

    // Delete the one-shot command AFTER reading it.
    deleteCommand();
    const path = planNavigateCommandPath(cmd);
    void prewarmPlanRoutePath(path);
    if (path !== "/") markAgentChatHomeHandoff("plans");
    const commitNavigation = () =>
      navigate(path, { replace: true, flushSync: true });
    if (
      typeof window !== "undefined" &&
      typeof window.queueMicrotask === "function"
    ) {
      window.queueMicrotask(commitNavigation);
    } else {
      window.setTimeout(commitNavigation, 0);
    }
    qc.setQueryData(["navigate-command"], null);
  }, [navCommand, navigate, qc]);
}

function viewForPath(pathname: string): string {
  // Recaps are a kind of plan; both detail routes map to the "plan" view so the
  // agent's navigation/selection state is the same surface regardless of route.
  if (
    pathname.startsWith("/plans/") ||
    pathname.startsWith("/recaps/") ||
    pathname.startsWith("/local-plans/")
  ) {
    return "plan";
  }
  if (pathname === "/") {
    return "chat";
  }
  if (
    pathname.startsWith("/plans") ||
    pathname.startsWith("/recaps") ||
    pathname.startsWith("/local-plans")
  ) {
    return "plans";
  }
  if (pathname.startsWith("/extensions")) return "extensions";
  if (pathname.startsWith("/team")) return "settings";
  return "plans";
}

export function planNavigateCommandPath(command: NavigationState): string {
  return routerPath(pathForCommand(command));
}

function pathForCommand(command: NavigationState): string {
  const commandPath = localPathFromCommandPath(command.path);
  if (commandPath) return commandPath;
  if (command.localPlanSlug) {
    const path = `/local-plans/${encodeURIComponent(command.localPlanSlug)}`;
    if (!command.localPlanPath) return path;
    return `${path}?${new URLSearchParams({
      path: command.localPlanPath,
    }).toString()}`;
  }
  if (command.planId) {
    return `/plans/${encodeURIComponent(command.planId)}`;
  }
  return pathForView(command.view);
}

function localPathFromCommandPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const origin =
      typeof window !== "undefined"
        ? window.location.origin
        : "http://localhost";
    const url = new URL(trimmed, origin);
    if (url.origin !== origin) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

function pathForView(view?: string): string {
  switch (view) {
    case "chat":
      return "/";
    case "plan":
    case "plans":
      return "/plans";
    case "extensions":
      return "/extensions";
    case "settings":
      return "/settings";
    case "team":
      return "/settings#organization";
    default:
      return "/";
  }
}

function routerPath(path: string): string {
  const basePath = appBasePath();
  if (!basePath) return path;
  let result = path;
  // React Router is already scoped to the app basename. Strip mounted URLs so
  // navigate() receives router-local paths and does not duplicate the prefix.
  for (let i = 0; i < 4; i += 1) {
    if (result === basePath) return "/";
    if (result.startsWith(`${basePath}/`)) {
      result = result.slice(basePath.length) || "/";
      continue;
    }
    if (
      result.startsWith(`${basePath}?`) ||
      result.startsWith(`${basePath}#`)
    ) {
      result = `/${result.slice(basePath.length)}`;
      continue;
    }
    break;
  }
  return result;
}
