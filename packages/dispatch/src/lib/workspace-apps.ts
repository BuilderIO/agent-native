import { isInBuilderFrame } from "@agent-native/core/client";

export interface WorkspaceAppSummary {
  id: string;
  name: string;
  description?: string;
  path: string;
  url?: string | null;
  isDispatch?: boolean;
  audience?: "internal" | "public";
  publicPaths?: string[];
  protectedPaths?: string[];
  status?: "ready" | "pending";
  statusLabel?: string;
  builderUrl?: string | null;
  branchName?: string | null;
  createdAt?: string | null;
  agentCardUrl?: string | null;
  agentCardReachable?: boolean;
  a2aEndpointUrl?: string | null;
  agentName?: string | null;
  agentSkillsCount?: number | null;
  archived?: boolean;
}

export function workspaceAppHref(app: WorkspaceAppSummary): string | null {
  if (app.status === "pending") return app.builderUrl || null;
  return app.path || app.url || null;
}

export function isPendingBuilderHref(app: WorkspaceAppSummary): boolean {
  return app.status === "pending" && !!app.builderUrl;
}

export function shouldOpenWorkspaceAppInTopWindow(): boolean {
  if (typeof window === "undefined") return false;
  return isInBuilderFrame() || window.parent !== window;
}

export function navigateToWorkspaceApp(href: string): void {
  if (typeof window === "undefined") return;

  const url = new URL(href, window.location.href).href;
  const targetWindow =
    shouldOpenWorkspaceAppInTopWindow() && window.top ? window.top : window;
  targetWindow.location.href = url;
}
