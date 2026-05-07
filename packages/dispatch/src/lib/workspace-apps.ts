export interface WorkspaceAppSummary {
  id: string;
  name: string;
  description?: string;
  path: string;
  url?: string | null;
  isDispatch?: boolean;
  status?: "ready" | "pending";
  statusLabel?: string;
  builderUrl?: string | null;
  branchName?: string | null;
}

export function workspaceAppHref(app: WorkspaceAppSummary): string | null {
  if (app.status === "pending") return app.builderUrl || null;
  return app.path || app.url || null;
}

export function isPendingBuilderHref(app: WorkspaceAppSummary): boolean {
  return app.status === "pending" && !!app.builderUrl;
}
