export interface WorkspaceAppSummary {
  id: string;
  name: string;
  description?: string;
  path: string;
  url?: string | null;
  isDispatch?: boolean;
  audience?: "internal" | "public";
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
