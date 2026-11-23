import type { getDb } from "../db/index.js";

/**
 * Every workspace read or write is scoped to the signed-in account *and* the
 * organisation the request was made in. A row belongs to exactly one pair, so
 * the same email signed into two organisations sees two separate workspaces.
 *
 * The scope is server request-derived. It is never built from a project or
 * collection id, and there is no synthetic owner-string sentinel for a missing
 * organisation: a request without one fails closed.
 */
export type WorkspaceScope = {
  ownerEmail: string;
  orgId: string;
};

/** A Drizzle handle, or the transaction handle threaded through a compound write. */
export type Queryable = ReturnType<typeof getDb>;

export class WorkspaceScopeError extends Error {
  readonly code = "workspace_scope_required";
  readonly statusCode = 403;

  constructor(message: string) {
    super(message);
    this.name = "WorkspaceScopeError";
  }
}

/**
 * Normalises a caller-supplied scope. Both parts are required; a blank or
 * missing organisation is a forbidden request, not an empty workspace.
 */
export function requireWorkspaceScope(
  scope: Partial<WorkspaceScope> | null | undefined,
): WorkspaceScope {
  const ownerEmail =
    typeof scope?.ownerEmail === "string" ? scope.ownerEmail.trim() : "";
  const orgId = typeof scope?.orgId === "string" ? scope.orgId.trim() : "";
  if (ownerEmail === "" || orgId === "") {
    throw new WorkspaceScopeError(
      "A signed-in account and an organisation are required to use the workspace.",
    );
  }
  return { ownerEmail, orgId };
}
