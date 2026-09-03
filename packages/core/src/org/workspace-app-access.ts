import { signA2AToken } from "../a2a/client.js";
import { getAppConfig } from "../app-config/index.js";
import { getDbExec } from "../db/client.js";
import { workspaceUserGroupsIncludeUser } from "../workspace-connections/groups.js";
import { getOrgA2ASecret, getOrgDomain } from "./context.js";

const WORKSPACE_APPS_ACTION_PATH = "/_agent-native/actions/list-workspace-apps";
const WORKSPACE_APP_ACCESS_TIMEOUT_MS = 2_500;

export interface WorkspaceAppAccessContext {
  email: string;
  orgId?: string | null;
}

function normalizedEmail(email: string): string {
  return email.trim().toLowerCase();
}

function configuredWorkspaceDirectory(): string | null {
  const workspace = getAppConfig().workspace;
  return (
    workspace.orgDirectoryUrl?.trim() || workspace.gatewayUrl?.trim() || null
  );
}

function workspaceAppsActionUrl(base: string): URL | null {
  try {
    const baseUrl = new URL(base);
    if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
      return null;
    }
    const basePath = baseUrl.pathname.replace(/\/+$/, "");
    baseUrl.pathname = `${basePath}${WORKSPACE_APPS_ACTION_PATH}`;
    baseUrl.search = "";
    baseUrl.searchParams.set("includeAgentCards", "false");
    baseUrl.searchParams.set("audience", "all");
    baseUrl.hash = "";
    return baseUrl;
  } catch {
    // coercion-ok: malformed configured URL is a typed unavailable registry.
    return null;
  }
}

function workspaceAppsFromResponse(value: unknown): Array<{ id?: unknown }> {
  if (Array.isArray(value)) return value as Array<{ id?: unknown }>;
  if (
    value &&
    typeof value === "object" &&
    Array.isArray((value as { apps?: unknown }).apps)
  ) {
    return (value as { apps: Array<{ id?: unknown }> }).apps;
  }
  return [];
}

/**
 * Hosted app databases are not the authority for workspace-app rows. Ask the
 * Dispatch registry action, which resolves the ACL against its shared store,
 * so an app-scoped database cannot accidentally turn a missing local row into
 * access. A configured registry is fail-closed on every network/auth error.
 */
async function hostedWorkspaceAppAccess(
  appId: string,
  context: WorkspaceAppAccessContext,
  email: string,
): Promise<boolean | null> {
  const configuredDirectory = configuredWorkspaceDirectory();
  if (!configuredDirectory) return null;

  const url = workspaceAppsActionUrl(configuredDirectory);
  if (!url) return false;

  const orgId = context.orgId?.trim() || null;
  const [orgDomain, orgSecret] = orgId
    ? await Promise.all([getOrgDomain(orgId), getOrgA2ASecret(orgId)])
    : [null, null];

  let token: string;
  try {
    token = await signA2AToken(
      email,
      orgDomain?.trim() || undefined,
      orgSecret?.trim() || undefined,
      {
        expiresIn: "1m",
        preferGlobalSecret: true,
        ...(orgId ? { extraClaims: { org_id: orgId } } : {}),
      },
    );
  } catch (error) {
    console.error("[workspace-app-access] registry token unavailable", error);
    return false;
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    WORKSPACE_APP_ACCESS_TIMEOUT_MS,
  );
  try {
    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
    });
    if (!response.ok) return false;
    const apps = workspaceAppsFromResponse(
      // coercion-ok: malformed registry JSON is an authorization failure.
      await response.json().catch(() => null),
    );
    return apps.some((app) => app.id === appId);
  } catch (error) {
    console.error("[workspace-app-access] registry access check failed", error);
    return false;
  } finally {
    clearTimeout(timeout);
  }
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

  const hostedAccess = await hostedWorkspaceAppAccess(
    normalizedAppId,
    context,
    email,
  );
  if (hostedAccess !== null) return hostedAccess;

  // Standalone/local deployments have no Dispatch registry URL. Keep the
  // direct lookup for that mode, but never let missing or malformed ACL state
  // grant access.
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
    if (!app) return false;

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
    if (memberResult.rows.length === 0) return false;
    const memberRole = String(memberResult.rows[0]?.role ?? "");
    if (memberRole === "owner" || memberRole === "admin") return true;

    if (app.visibility === "org") return true;
    if (app.visibility !== "private") return false;

    const userShare = await db.execute({
      sql: `SELECT 1 FROM workspace_app_shares
            WHERE resource_id = ? AND principal_type = 'user'
              AND LOWER(principal_id) = ? LIMIT 1`,
      args: [normalizedAppId, email],
    });
    if (userShare.rows.length > 0) return true;

    const orgShare = await db.execute({
      sql: `SELECT 1 FROM workspace_app_shares
            WHERE resource_id = ? AND principal_type = 'org'
              AND principal_id = ? LIMIT 1`,
      args: [normalizedAppId, orgId],
    });
    if (orgShare.rows.length > 0) return true;

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
    // Missing migrations, missing rows, and every other DB failure deny
    // protected app access until the authoritative ACL is available.
    console.error("[workspace-app-access] access check failed", error);
    return false;
  }
}
