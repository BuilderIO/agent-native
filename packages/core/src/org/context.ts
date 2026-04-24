import type { H3Event } from "h3";
import { getSession } from "../server/auth.js";
import { getUserSetting } from "../settings/user-settings.js";
import { getDbExec } from "../db/client.js";
import type { OrgContext, OrgRole } from "./types.js";

/**
 * Resolve the current user's organization context from their session.
 *
 * - For users in multiple orgs, honors their `active-org-id` user setting.
 * - Falls back to the user's first membership.
 * - `local@localhost` (dev / no-auth mode) is treated as a regular identity:
 *   it owns whatever orgs it has created locally.
 */
export async function getOrgContext(event: H3Event): Promise<OrgContext> {
  const session = await getSession(event);
  const email = session?.email ?? "local@localhost";

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
