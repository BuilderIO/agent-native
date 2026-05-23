import { useEffect } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  agentNativePath,
  appBasePath,
  appPath,
} from "@agent-native/core/client";

export interface NavigationState {
  view: string;
  path?: string;
  /** PR identity */
  owner?: string;
  repo?: string;
  prNumber?: number;
  /** Run identity */
  runId?: string;
  /** Custom tool identity (a.k.a. extension id) */
  extensionId?: string;
  /** Settings section anchor */
  section?: string;
}

export function useNavigationState() {
  const location = useLocation();
  const params = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  // Sync current route to application state
  useEffect(() => {
    const localPathname = routerPath(location.pathname);
    const state = buildWorkbenchNavigationState(localPathname, params);

    fetch(agentNativePath("/_agent-native/application-state/navigation"), {
      method: "PUT",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    }).catch(() => {});
  }, [location.pathname, params]);

  // Listen for navigate commands from agent
  const { data: navCommand } = useQuery({
    queryKey: ["navigate-command"],
    queryFn: async () => {
      const res = await fetch(
        agentNativePath("/_agent-native/application-state/navigate"),
      );
      if (!res.ok) return null;
      const data = await res.json();
      if (data) {
        return { ...data, _ts: Date.now() };
      }
      return null;
    },
    refetchInterval: 2_000,
    structuralSharing: false,
  });

  useEffect(() => {
    if (!navCommand) return;
    fetch(agentNativePath("/_agent-native/application-state/navigate"), {
      method: "DELETE",
      headers: { "X-Agent-Native-CSRF": "1" },
    }).catch(() => {});
    const cmd = navCommand as NavigationState;
    const resolvedPath = cmd.path || resolvePath(cmd) || "/";
    navigate(routerPath(resolvedPath));
    qc.setQueryData(["navigate-command"], null);
  }, [navCommand, navigate, qc]);
}

export function buildWorkbenchNavigationState(
  pathname: string,
  params: Record<string, string | undefined>,
): NavigationState {
  const view = resolveView(pathname);
  const state: NavigationState = {
    view,
    path: appPath(pathname),
  };

  if (view === "pr") {
    if (params.owner) state.owner = params.owner;
    if (params.repo) state.repo = params.repo;
    if (params.n) state.prNumber = Number(params.n);
  }

  if (view === "run" && params.id) state.runId = params.id;
  if (view === "extension" && params.id) state.extensionId = params.id;

  return state;
}

function routerPath(path: string): string {
  const basePath = appBasePath();
  if (!basePath) return path;
  let result = path;
  for (let i = 0; i < 4; i += 1) {
    if (result === basePath) return "/";
    if (!result.startsWith(`${basePath}/`)) break;
    result = result.slice(basePath.length) || "/";
  }
  return result;
}

function resolveView(pathname: string): string {
  if (pathname === "/" || pathname === "") return "queue";
  if (pathname.startsWith("/prs/")) return "pr";
  if (pathname === "/prs") return "prs";
  if (pathname.startsWith("/runs/")) return "run";
  if (pathname === "/runs") return "runs";
  if (pathname.startsWith("/code/")) return "code-file";
  if (pathname === "/code") return "code";
  if (pathname.startsWith("/extensions/")) return "extension";
  if (pathname === "/extensions") return "extensions";
  if (pathname.startsWith("/settings")) return "settings";
  if (pathname.startsWith("/onboarding")) return "onboarding";
  return "queue";
}

function resolvePath(cmd: NavigationState): string | undefined {
  switch (cmd.view) {
    case "queue":
      return "/";
    case "prs":
      return "/prs";
    case "pr":
      if (cmd.owner && cmd.repo && cmd.prNumber) {
        return `/prs/${encodeURIComponent(cmd.owner)}/${encodeURIComponent(cmd.repo)}/${cmd.prNumber}`;
      }
      return "/prs";
    case "runs":
      return "/runs";
    case "run":
      return cmd.runId ? `/runs/${encodeURIComponent(cmd.runId)}` : "/runs";
    case "extensions":
      return "/extensions";
    case "extension":
      return cmd.extensionId
        ? `/extensions/${encodeURIComponent(cmd.extensionId)}`
        : "/extensions";
    case "code":
      return "/code";
    case "code-file":
      // Navigate via path-based form when a file is provided.
      return cmd.path ?? "/code";
    case "settings":
      return "/settings";
    case "onboarding":
      return "/onboarding";
    default:
      return undefined;
  }
}
