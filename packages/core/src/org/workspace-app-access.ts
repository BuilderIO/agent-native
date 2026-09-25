import { signA2AToken } from "../a2a/client.js";
import { getAppConfig } from "../app-config/index.js";
import { getDbExec, type DbExec } from "../db/client.js";
import {
  isHostedWorkspaceRuntime,
  resolveVercelDeploymentProtectionHeaders,
} from "../server/deployment-protection.js";
import { workspaceUserGroupsIncludeUser } from "../workspace-connections/groups.js";
import { isMissingOrganizationTableError } from "./membership.js";
import { cachedWorkspaceAppAccess } from "./workspace-app-access-cache.js";

const WORKSPACE_APPS_ACTION_PATH = "/_agent-native/actions/list-workspace-apps";
const WORKSPACE_APP_CLAIM_ACTION_PATH =
  "/_agent-native/actions/claim-workspace-app-organization";

export interface WorkspaceAppAccessContext {
  email: string;
  orgId?: string | null;
}

interface WorkspaceOrgMember {
  role: string;
  identityAuthority: string;
  identityId: string;
}

function normalizedEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isStandaloneDispatchRuntime(): boolean {
  const app = getAppConfig().app;
  const isDispatch = [
    app.id,
    app.legacyId,
    app.template,
    app.slug,
    app.packageName,
  ].some((value) => value?.trim().toLowerCase() === "dispatch");
  return isDispatch && !isHostedWorkspaceRuntime();
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

function workspaceAppsFromResponse(
  value: unknown,
): Array<{ id?: unknown; orgEnabled?: unknown; org_enabled?: unknown }> {
  if (Array.isArray(value)) {
    return value as Array<{
      id?: unknown;
      orgEnabled?: unknown;
      org_enabled?: unknown;
    }>;
  }
  if (
    value &&
    typeof value === "object" &&
    Array.isArray((value as { apps?: unknown }).apps)
  ) {
    return (
      value as {
        apps: Array<{
          id?: unknown;
          orgEnabled?: unknown;
          org_enabled?: unknown;
        }>;
      }
    ).apps;
  }
  return [];
}

function workspaceAppIsDisabled(app: {
  orgEnabled?: unknown;
  org_enabled?: unknown;
}): boolean {
  const value = app.orgEnabled ?? app.org_enabled;
  return value === false || value === 0 || value === "false" || value === "0";
}

/**
 * Hosted app databases are not the authority for workspace-app rows. Ask the
 * Dispatch registry action, which resolves the ACL against its shared store,
 * so an app-scoped database cannot accidentally turn a missing local row into
 * access. A configured registry is fail-closed on every network/auth error.
 */
async function hostedWorkspaceAppAccess(
  configuredDirectory: string,
  appId: string,
  email: string,
  orgId: string | null,
): Promise<boolean> {
  const url = workspaceAppsActionUrl(configuredDirectory);
  if (!url) return false;

  const [orgDomain, orgSecret] = orgId
    ? await Promise.all([
        import("./context.js").then(({ getOrgDomain }) => getOrgDomain(orgId)),
        import("./context.js").then(({ getOrgA2ASecret }) =>
          getOrgA2ASecret(orgId),
        ),
      ])
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
    getAppConfig().workspace.appAccessTimeoutMs,
  );
  try {
    const protectionHeaders = resolveVercelDeploymentProtectionHeaders(
      url.toString(),
    );
    const headers = {
      accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...protectionHeaders,
    };
    const response = await fetch(url, {
      headers,
      ...(protectionHeaders["x-vercel-protection-bypass"]
        ? { redirect: "manual" as const }
        : {}),
      signal: controller.signal,
    });
    if (!response.ok) return false;
    const apps = workspaceAppsFromResponse(
      // coercion-ok: malformed registry JSON is an authorization failure.
      await response.json().catch(() => null),
    );
    const matchingApp = apps.find((app) => app.id === appId);
    if (matchingApp) return !workspaceAppIsDisabled(matchingApp);

    const claimUrl = new URL(url);
    claimUrl.pathname = claimUrl.pathname.replace(
      WORKSPACE_APPS_ACTION_PATH,
      WORKSPACE_APP_CLAIM_ACTION_PATH,
    );
    claimUrl.search = "";
    const claimResponse = await fetch(claimUrl, {
      method: "POST",
      headers: {
        ...headers,
        "content-type": "application/json",
      },
      ...(protectionHeaders["x-vercel-protection-bypass"]
        ? { redirect: "manual" as const }
        : {}),
      body: JSON.stringify({ appId }),
      signal: controller.signal,
    });
    if (!claimResponse.ok) return false;
    // coercion-ok: malformed registry JSON is an authorization failure.
    const claim = (await claimResponse.json().catch(() => null)) as {
      allowed?: unknown;
    } | null;
    if (claim?.allowed !== true) return false;

    const refreshedResponse = await fetch(url, {
      headers,
      ...(protectionHeaders["x-vercel-protection-bypass"]
        ? { redirect: "manual" as const }
        : {}),
      signal: controller.signal,
    });
    if (!refreshedResponse.ok) return false;
    const refreshedApps = workspaceAppsFromResponse(
      // coercion-ok: malformed registry JSON is an authorization failure.
      await refreshedResponse.json().catch(() => null),
    );
    const refreshedApp = refreshedApps.find((app) => app.id === appId);
    return refreshedApp ? !workspaceAppIsDisabled(refreshedApp) : false;
  } catch (error) {
    console.error("[workspace-app-access] registry access check failed", error);
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function localOrganizationAppEnabled(
  appId: string,
  orgId: string | null,
): Promise<boolean | null> {
  if (!orgId) return null;
  try {
    const result = await getDbExec().execute({
      sql: `SELECT org_enabled FROM workspace_apps
            WHERE id = ? AND org_id = ? LIMIT 1`,
      args: [appId, orgId],
    });
    const row = Array.isArray(result?.rows)
      ? (result.rows[0] as { org_enabled?: unknown } | undefined)
      : undefined;
    if (!row) return null;
    return !(
      row.org_enabled === false ||
      row.org_enabled === 0 ||
      row.org_enabled === "false" ||
      row.org_enabled === "0"
    );
  } catch (error) {
    if (!isMissingOrganizationTableError(error)) {
      console.error(
        "[workspace-app-access] local organization app state unavailable",
        error,
      );
    }
    return null;
  }
}

async function loadWorkspaceOrgMember(
  db: DbExec,
  orgId: string,
  email: string,
): Promise<WorkspaceOrgMember | null> {
  let memberResult;
  try {
    memberResult = await db.execute({
      sql: `SELECT m.role,
                   o.identity_authority AS "identityAuthority",
                   o.identity_id AS "identityId"
            FROM org_members m
            LEFT JOIN organizations o ON o.id = m.org_id
            WHERE m.org_id = ? AND LOWER(m.email) = ?
              AND m.federation_removal_pending_at IS NULL
            LIMIT 1`,
      args: [orgId, email],
    });
  } catch (error) {
    if (!isMissingOrganizationTableError(error)) throw error;
    if (!isStandaloneDispatchRuntime()) throw error;
    memberResult = await db.execute({
      sql: `SELECT role FROM org_members
            WHERE org_id = ? AND LOWER(email) = ?
              AND federation_removal_pending_at IS NULL
            LIMIT 1`,
      args: [orgId, email],
    });
  }

  const row = memberResult.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    role: String(row.role ?? ""),
    identityAuthority: String(
      row.identityAuthority ?? row.identity_authority ?? "",
    ).trim(),
    identityId: String(row.identityId ?? row.identity_id ?? "").trim(),
  };
}

async function isActiveWorkspaceOrgMember(
  member: WorkspaceOrgMember,
  orgId: string,
  email: string,
): Promise<boolean> {
  if (!member.identityAuthority && !member.identityId) return true;
  const { validateFederatedOrganizationMembershipForCurrentRequest } =
    await import("./federation.js");
  const membership =
    await validateFederatedOrganizationMembershipForCurrentRequest({
      orgId,
      email,
    });
  return membership.active;
}

async function claimWorkspaceAppOrganization(
  db: DbExec,
  appId: string,
  orgId: string,
  member: WorkspaceOrgMember,
): Promise<boolean> {
  if (member.role !== "owner" && member.role !== "admin") {
    return false;
  }
  const claim = await db.execute({
    sql: `UPDATE workspace_apps SET org_id = ?
          WHERE id = ? AND org_id IS NULL
            AND TRIM(owner_email) = '' AND visibility = 'org'
          RETURNING org_id`,
    args: [orgId, appId],
  });
  if (claim.rows.length > 0) return true;

  const current = await db.execute({
    sql: `SELECT org_id FROM workspace_apps WHERE id = ? LIMIT 1`,
    args: [appId],
  });
  return current.rows[0]?.org_id === orgId;
}

export async function claimWorkspaceAppForOrganization(
  appId: string,
  context: WorkspaceAppAccessContext,
): Promise<boolean> {
  const normalizedAppId = appId.trim();
  const email = normalizedEmail(context.email);
  const orgId = context.orgId?.trim() || null;
  if (!normalizedAppId || !email || !orgId) return false;

  try {
    const db = getDbExec();
    const member = await loadWorkspaceOrgMember(db, orgId, email);
    if (!member || !(await isActiveWorkspaceOrgMember(member, orgId, email))) {
      return false;
    }
    return claimWorkspaceAppOrganization(db, normalizedAppId, orgId, member);
  } catch (error) {
    console.error("[workspace-app-access] organization claim failed", error);
    return false;
  }
}

async function isDispatchWorkspaceAppAccessAllowed(
  context: WorkspaceAppAccessContext,
  email: string,
): Promise<boolean> {
  const orgId = context.orgId?.trim() || null;
  if (!orgId) return true;

  try {
    const member = await loadWorkspaceOrgMember(getDbExec(), orgId, email);
    // Standalone Dispatch hosts can carry an org id before enabling the org
    // schema. Preserve their authenticated-only access until that schema exists.
    return Boolean(
      member && (await isActiveWorkspaceOrgMember(member, orgId, email)),
    );
  } catch (error) {
    if (
      isMissingOrganizationTableError(error) &&
      isStandaloneDispatchRuntime()
    ) {
      return true;
    }
    console.error("[workspace-app-access] Dispatch access check failed", error);
    return false;
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
  if (!normalizedAppId || !email) {
    return true;
  }
  if (normalizedAppId.toLowerCase() === "dispatch") {
    return isDispatchWorkspaceAppAccessAllowed(context, email);
  }

  const configuredDirectory = configuredWorkspaceDirectory();
  if (configuredDirectory) {
    const orgId = context.orgId?.trim() || null;
    // A local disable is an explicit organization decision and must win over
    // the hosted registry response, so it is read on every request and never
    // served from the decision cache. Missing local rows preserve the registry
    // path for hosted deployments that do not mirror workspace_apps locally.
    const locallyEnabled = await localOrganizationAppEnabled(
      normalizedAppId,
      orgId,
    );
    if (locallyEnabled === false) return false;

    return cachedWorkspaceAppAccess(
      { appId: normalizedAppId, email, orgId },
      () =>
        hostedWorkspaceAppAccess(
          configuredDirectory,
          normalizedAppId,
          email,
          orgId,
        ),
    );
  }

  // Standalone/local deployments have no Dispatch registry URL. Keep the
  // direct lookup for that mode, but never let missing or malformed ACL state
  // grant access.
  try {
    const db = getDbExec();
    const appResult = await db.execute({
      sql: `SELECT owner_email, org_id, visibility, org_enabled
            FROM workspace_apps WHERE id = ? LIMIT 1`,
      args: [normalizedAppId],
    });
    const app = appResult.rows[0] as
      | {
          owner_email?: unknown;
          org_id?: unknown;
          visibility?: unknown;
          org_enabled?: unknown;
        }
      | undefined;
    if (!app) return false;

    const ownerEmail = normalizedEmail(
      typeof app.owner_email === "string" ? app.owner_email : "",
    );
    const resourceOrgId =
      (typeof app.org_id === "string" ? app.org_id : "").trim() || null;
    const orgId = context.orgId?.trim() || null;
    const sameOrg = !!resourceOrgId && resourceOrgId === orgId;
    const orgEnabled =
      app.org_enabled !== false &&
      app.org_enabled !== 0 &&
      app.org_enabled !== "false" &&
      app.org_enabled !== "0";
    const canClaimCallerOrg =
      !resourceOrgId && !ownerEmail && app.visibility === "org" && !!orgId;

    if (sameOrg && !orgEnabled) return false;
    if (ownerEmail === email && (!resourceOrgId || sameOrg)) return true;
    if ((!sameOrg && !canClaimCallerOrg) || !orgId) return false;

    const member = await loadWorkspaceOrgMember(db, orgId, email);
    if (!member || !(await isActiveWorkspaceOrgMember(member, orgId, email))) {
      return false;
    }
    const memberRole = member.role;
    if (canClaimCallerOrg) {
      // Fresh workspaces register apps before their first organization exists.
      // Claim once so a missing org never becomes cross-organization access.
      if (
        !(await claimWorkspaceAppOrganization(
          db,
          normalizedAppId,
          orgId,
          member,
        ))
      ) {
        return false;
      }
    }
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
