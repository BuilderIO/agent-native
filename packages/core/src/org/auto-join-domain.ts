import { getDbExec } from "../db/client.js";
import { getUserSetting, putUserSetting } from "../settings/user-settings.js";

const nanoid = (): string =>
  globalThis.crypto?.randomUUID?.().replace(/-/g, "") ??
  Math.random().toString(36).slice(2) + Date.now().toString(36);

export interface AutoJoinDomainResult {
  joined: Array<{ orgId: string }>;
  activeOrgId: string | null;
}

/**
 * Auto-join a newly-signed-up user into every org whose `allowed_domain`
 * matches their email domain.
 *
 * Called from the Better Auth `user.create.after` hook so that e.g. a new
 * `@builder.io` signup lands inside the existing Builder.io org on first
 * page load instead of starting in Personal and having to find the join
 * CTA. The org's owner opts into this by setting
 * `organizations.allowed_domain` — the column already gated the manual
 * "Join your team" UI in the picker; we use the same opt-in to drive
 * automatic join.
 *
 * Idempotent — skips orgs the user is already a member of and never
 * overwrites an existing `active-org-id` setting.
 *
 * Safe to call when the org tables don't exist (some templates don't use
 * the org module): it swallows the "no such table" error and returns
 * empty. Never throws — the caller is a signup hook and we don't want to
 * block a user from creating their account because of an org-tier issue.
 */
export async function autoJoinDomainMatchingOrgs(
  rawEmail: string,
): Promise<AutoJoinDomainResult> {
  const email = rawEmail.trim().toLowerCase();
  if (!email) return { joined: [], activeOrgId: null };

  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return { joined: [], activeOrgId: null };

  const db = getDbExec();

  let matches: Array<{ orgId: string }> = [];
  try {
    const res = await db.execute({
      sql: `SELECT o.id AS "orgId"
            FROM organizations o
            WHERE LOWER(o.allowed_domain) = ?
              AND NOT EXISTS (
                SELECT 1
                FROM org_members m
                WHERE m.org_id = o.id
                  AND LOWER(m.email) = ?
              )
            ORDER BY o.created_at ASC`,
      args: [domain, email],
    });
    matches = res.rows.map((r: any) => ({
      orgId: String(r.orgId ?? r.org_id),
    }));
  } catch {
    // Template without org tables (or `allowed_domain` column not yet
    // migrated). Not fatal — return empty.
    return { joined: [], activeOrgId: null };
  }

  if (matches.length === 0) return { joined: [], activeOrgId: null };

  const joined: AutoJoinDomainResult["joined"] = [];
  for (const m of matches) {
    try {
      await db.execute({
        sql: `INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES (?, ?, ?, 'member', ?)`,
        args: [nanoid(), m.orgId, email, Date.now()],
      });
      joined.push({ orgId: m.orgId });
    } catch {
      // Race with a parallel join (e.g. user accepted an invite to the
      // same org milliseconds earlier). The unique constraint keeps the
      // existing membership intact; just skip this org.
    }
  }

  // Set active-org-id to the first match only if the user doesn't
  // already have one (a pending invite that ran first may have set it).
  let activeOrgId: string | null = null;
  if (joined[0]) {
    try {
      const existing = await getUserSetting(email, "active-org-id");
      const hasActive = Boolean(existing?.orgId);
      if (!hasActive) {
        activeOrgId = joined[0].orgId;
        await putUserSetting(email, "active-org-id", { orgId: activeOrgId });
      }
    } catch {
      // settings table missing — not fatal.
    }
  }

  return { joined, activeOrgId };
}
