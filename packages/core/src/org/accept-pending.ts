import { getDbExec } from "../db/client.js";
import { putUserSetting } from "../settings/user-settings.js";

const nanoid = (): string =>
  globalThis.crypto?.randomUUID?.().replace(/-/g, "") ??
  Math.random().toString(36).slice(2) + Date.now().toString(36);

export interface AcceptPendingResult {
  accepted: Array<{ invitationId: string; orgId: string }>;
  activeOrgId: string | null;
}

/**
 * Accept every pending `org_invitations` row for this email:
 *   - insert a matching `org_members` row (role 'member') when one doesn't exist
 *   - flip the invitation's status to 'accepted'
 *   - set the user's `active-org-id` to the most-recently-created invite
 *
 * Called from the Better Auth `user.create.after` hook so that a user who signs
 * up with an email they were just invited to lands in the org immediately,
 * rather than seeing a blank-slate app until they navigate to /team.
 *
 * Safe to call when the org tables don't exist (some templates don't use the
 * org module) — it swallows the "no such table" error and returns empty.
 */
export async function acceptPendingInvitationsForEmail(
  rawEmail: string,
): Promise<AcceptPendingResult> {
  const email = rawEmail.trim().toLowerCase();
  if (!email) {
    return { accepted: [], activeOrgId: null };
  }

  const db = getDbExec();

  let rows: Array<{ id: string; orgId: string }> = [];
  try {
    const res = await db.execute({
      sql: `SELECT id, org_id AS "orgId" FROM org_invitations
            WHERE LOWER(email) = ? AND status = 'pending'
            ORDER BY created_at DESC`,
      args: [email],
    });
    rows = res.rows.map((r: any) => ({
      id: String(r.id),
      orgId: String(r.orgId ?? r.org_id),
    }));
  } catch (err) {
    // Template doesn't use the org module / tables not migrated yet.
    return { accepted: [], activeOrgId: null };
  }

  if (rows.length === 0) {
    return { accepted: [], activeOrgId: null };
  }

  const accepted: AcceptPendingResult["accepted"] = [];
  for (const inv of rows) {
    const existing = await db.execute({
      sql: `SELECT 1 FROM org_members WHERE org_id = ? AND LOWER(email) = ? LIMIT 1`,
      args: [inv.orgId, email],
    });
    if (existing.rows.length === 0) {
      await db.execute({
        sql: `INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES (?, ?, ?, 'member', ?)`,
        args: [nanoid(), inv.orgId, email, Date.now()],
      });
    }
    await db.execute({
      sql: `UPDATE org_invitations SET status = 'accepted' WHERE id = ?`,
      args: [inv.id],
    });
    accepted.push({ invitationId: inv.id, orgId: inv.orgId });
  }

  // Set active-org-id to the most recent invite so the user lands in a
  // populated workspace on first load.
  const activeOrgId = accepted[0]?.orgId ?? null;
  if (activeOrgId) {
    try {
      await putUserSetting(email, "active-org-id", { orgId: activeOrgId });
    } catch {
      // user_settings table might not exist in a minimal template — not fatal.
    }
  }

  return { accepted, activeOrgId };
}
