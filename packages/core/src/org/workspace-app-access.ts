import { getDbExec } from "../db/client.js";
import { workspaceUserGroupsIncludeUser } from "../workspace-connections/groups.js";

export interface WorkspaceAppAccessContext {
  email: string;
  orgId?: string | null;
}

function normalizedEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isMissingWorkspaceAppSchema(error: unknown): boolean {
  const message = String((error as { message?: unknown })?.message ?? error);
  return /no such table|relation .* does not exist|does not exist/i.test(
    message,
  );
}

/**
 * Enforce the workspace-app ACL before a hosted app's authenticated API
 * surface is reached. The app shell remains cacheable and anonymous; this
 * check protects the session-backed APIs/actions that make the app useful.
 */
export async function isWorkspaceAppAccessAllowed(
  appId: string,
  context: WorkspaceAppAccessContext,
): Promise<boolean> {
  const normalizedAppId = appId.trim();
  const email = normalizedEmail(context.email);
  if (!normalizedAppId || normalizedAppId === "dispatch" || !email) {
    return true;
  }

  try {
    const db = getDbExec();
    const appResult = await db.execute({
      sql: `SELECT owner_email, org_id, visibility
            FROM workspace_apps WHERE id = ? LIMIT 1`,
      args: [normalizedAppId],
    });
    const app = appResult.rows[0] as
      | { owner_email?: unknown; org_id?: unknown; visibility?: unknown }
      | undefined;
    // Dispatch seeds this record when it discovers the app. Keep legacy apps
    // reachable until that first discovery pass has a chance to create it.
    if (!app) return true;

    const ownerEmail = normalizedEmail(
      typeof app.owner_email === "string" ? app.owner_email : "",
    );
    const resourceOrgId =
      (typeof app.org_id === "string" ? app.org_id : "").trim() || null;
    const orgId = context.orgId?.trim() || null;
    const sameOrg = !!resourceOrgId && resourceOrgId === orgId;

    if (ownerEmail === email && (!resourceOrgId || sameOrg)) return true;
    if (!sameOrg || !orgId) return false;

    const memberResult = await db.execute({
      sql: `SELECT role FROM org_members
            WHERE org_id = ? AND LOWER(email) = ? LIMIT 1`,
      args: [orgId, email],
    });
    const memberRole = String(memberResult.rows[0]?.role ?? "");
    if (memberRole === "owner" || memberRole === "admin") return true;

    if (
      app.visibility === "org" ||
      app.visibility === undefined ||
      app.visibility === null
    ) {
      return true;
    }

    const userShare = await db.execute({
      sql: `SELECT 1 FROM workspace_app_shares
            WHERE resource_id = ? AND principal_type = 'user'
              AND LOWER(principal_id) = ? LIMIT 1`,
      args: [normalizedAppId, email],
    });
    if (userShare.rows.length > 0) return true;

    const groupShares = await db.execute({
      sql: `SELECT principal_id FROM workspace_app_shares
            WHERE resource_id = ? AND principal_type = 'group'`,
      args: [normalizedAppId],
    });
    const groupIds = groupShares.rows
      .map((row) =>
        typeof row.principal_id === "string" ? row.principal_id : "",
      )
      .filter(Boolean);
    return workspaceUserGroupsIncludeUser(resourceOrgId, groupIds, email);
  } catch (error) {
    // Older deployments may not have received the additive migrations yet.
    // Do not strand them before the framework can run migrations; once the
    // schema exists, query failures remain a deny-by-default result.
    if (isMissingWorkspaceAppSchema(error)) return true;
    console.error("[workspace-app-access] access check failed", error);
    return false;
  }
}
