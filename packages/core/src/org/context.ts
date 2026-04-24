import type { H3Event } from "h3";
import { getSession } from "../server/auth.js";
import { getUserSetting, putUserSetting } from "../settings/user-settings.js";
import { getDbExec } from "../db/client.js";
import type { OrgContext, OrgRole } from "./types.js";

const EMPTY_CONTEXT: OrgContext = {
  email: "",
  orgId: null,
  orgName: null,
  role: null,
};

const nanoid = (): string =>
  globalThis.crypto?.randomUUID?.().replace(/-/g, "") ??
  Math.random().toString(36).slice(2) + Date.now().toString(36);

/**
 * Resolve the current user's organization context from their session.
 *
 * - For users in multiple orgs, honors their `active-org-id` user setting.
 * - Falls back to the user's first membership.
 * - `local@localhost` (dev / no-auth mode) is treated as a regular identity:
 *   it owns whatever orgs it has created locally.
 * - When `AUTO_CREATE_DEFAULT_ORG` is set and the authenticated user has
 *   zero memberships, provisions a default org named after the user
 *   ({name}'s workspace, falling back to the email local-part). Opt-in
 *   per deployment so templates that don't use orgs don't accrue phantom
 *   default orgs in their DB. The <RequireActiveOrg> client guard remains
 *   the safety net for pre-existing accounts or provisioning failures.
 */
export async function getOrgContext(event: H3Event): Promise<OrgContext> {
  const session = await getSession(event);
  const email = session?.email;
  // No `?? "local@localhost"` fallback — if the session is genuinely
  // missing (misconfigured prod, expired token mid-request) don't
  // silently promote the caller to the shared dev identity.
  if (!email) return EMPTY_CONTEXT;

  const exec = getDbExec();

  let memberships: Array<{
    orgId: string;
    role: OrgRole;
    orgName: string;
  }> = [];
  try {
    const { rows } = await exec.execute({
      sql: `SELECT m.org_id AS "orgId", m.role AS role, o.name AS "orgName"
            FROM org_members m
            INNER JOIN organizations o ON m.org_id = o.id
            WHERE LOWER(m.email) = ?`,
      args: [email.toLowerCase()],
    });
    memberships = rows.map((r: any) => ({
      orgId: String(r.orgId ?? r.org_id),
      role: String(r.role) as OrgRole,
      orgName: String(r.orgName ?? r.org_name),
    }));
  } catch {
    // Tables may not exist yet on first boot before migrations finish.
    return { email, orgId: null, orgName: null, role: null };
  }

  if (memberships.length === 0 && process.env.AUTO_CREATE_DEFAULT_ORG) {
    const created = await tryCreateDefaultOrg(exec, email, session);
    if (created) return created;
    // Creation failed (race / DB error); fall through and let the
    // RequireActiveOrg client guard prompt the user.
  }

  if (memberships.length === 0) {
    return { email, orgId: null, orgName: null, role: null };
  }

  if (memberships.length > 1) {
    const activeOrgSetting = (await getUserSetting(email, "active-org-id")) as {
      orgId: string;
    } | null;
    if (activeOrgSetting?.orgId) {
      const active = memberships.find(
        (m) => m.orgId === activeOrgSetting.orgId,
      );
      if (active) {
        return {
          email,
          orgId: active.orgId,
          orgName: active.orgName,
          role: active.role,
        };
      }
    }
  }

  return {
    email,
    orgId: memberships[0].orgId,
    orgName: memberships[0].orgName,
    role: memberships[0].role,
  };
}

function defaultOrgName(
  email: string,
  session: { name?: string } | null,
): string {
  const full = session?.name?.trim();
  if (full) return `${full}'s workspace`;
  const local = email.split("@")[0] ?? email;
  const cleaned = local.replace(/[._-]+/g, " ").trim();
  const titled =
    cleaned
      .split(" ")
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ") || "My";
  return `${titled}'s workspace`;
}

/**
 * Attempt to provision a default org + owner membership for a user with
 * zero memberships. Re-queries before inserting to catch a concurrent
 * request that already created one, and returns the existing org in that
 * case. Returns null on any failure so the caller can fall back to the
 * empty-context / client-guard path.
 */
async function tryCreateDefaultOrg(
  exec: ReturnType<typeof getDbExec>,
  email: string,
  session: { name?: string } | null,
): Promise<OrgContext | null> {
  try {
    const existing = await exec.execute({
      sql: `SELECT m.org_id AS "orgId", m.role AS role, o.name AS "orgName"
            FROM org_members m
            INNER JOIN organizations o ON m.org_id = o.id
            WHERE LOWER(m.email) = ?
            LIMIT 1`,
      args: [email.toLowerCase()],
    });
    if (existing.rows.length > 0) {
      const r = existing.rows[0] as any;
      return {
        email,
        orgId: String(r.orgId ?? r.org_id),
        orgName: String(r.orgName ?? r.org_name),
        role: String(r.role) as OrgRole,
      };
    }

    const orgId = nanoid();
    const orgName = defaultOrgName(email, session);
    const now = Date.now();

    await exec.execute({
      sql: `INSERT INTO organizations (id, name, created_by, created_at) VALUES (?, ?, ?, ?)`,
      args: [orgId, orgName, email, now],
    });
    await exec.execute({
      sql: `INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES (?, ?, ?, ?, ?)`,
      args: [nanoid(), orgId, email, "owner", now],
    });

    await putUserSetting(email, "active-org-id", { orgId });

    return { email, orgId, orgName, role: "owner" };
  } catch {
    return null;
  }
}
