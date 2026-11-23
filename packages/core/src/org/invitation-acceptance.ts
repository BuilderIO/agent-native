import type { DbExec } from "../db/client.js";
import { identityCredentialLockKey } from "../identity/retired-emails.js";
import { applyInvitationAppRoles } from "./app-roles.js";

class InvitationNoLongerLive extends Error {}

/**
 * Completes an invitation under the per-address advisory lock that
 * `offboardMember` also takes: the join, the app-role grants and the
 * pending-to-accepted flip commit together, and the invitation, the removal
 * marker and (for an existing member) the membership are re-read inside the
 * lock. A removal that commits first therefore wins, and one that starts later
 * finds the finished membership and removes it with its roles. Returns false,
 * with nothing written, when the invitation is no longer live.
 */
export async function acceptLiveInvitation(
  db: DbExec,
  invitation: {
    invitationId: string;
    orgId: string;
    email: string;
    memberId: string;
    joinMember: boolean;
    updatedBy: string;
  },
): Promise<boolean> {
  const email = invitation.email.trim().toLowerCase();
  if (!db.transaction)
    throw new Error("Interactive transactions are unavailable");
  return db
    .transaction(async (tx) => {
      await tx.execute({
        sql: "SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))",
        args: [identityCredentialLockKey(email)],
      });
      const current = await tx.execute({
        sql: `SELECT role, app_roles_json AS "appRolesJson" FROM org_invitations
            WHERE id = ? AND org_id = ? AND LOWER(email) = ? AND status = 'pending'
            LIMIT 1 FOR UPDATE`,
        args: [invitation.invitationId, invitation.orgId, email],
      });
      const pending = current.rows[0] as Record<string, unknown> | undefined;
      if (!pending) return false;
      const removed = await tx.execute({
        sql: `SELECT 1 FROM org_invitations
            WHERE org_id = ? AND LOWER(email) = ? AND status = 'deactivated' LIMIT 1`,
        args: [invitation.orgId, email],
      });
      if (removed.rows.length > 0) return false;
      const membership = await tx.execute({
        sql: `SELECT federation_removal_pending_at FROM org_members
            WHERE org_id = ? AND LOWER(email) = ? LIMIT 1 FOR UPDATE`,
        args: [invitation.orgId, email],
      });
      const member = membership.rows[0] as Record<string, unknown> | undefined;
      if (member?.federation_removal_pending_at) return false;
      if (!member && !invitation.joinMember) return false;
      const role = pending.role === "admin" ? "admin" : "member";
      const appRolesJson =
        pending.appRolesJson == null ? null : String(pending.appRolesJson);
      if (!member) {
        await tx.execute({
          sql: `INSERT INTO org_members (id, org_id, email, role, joined_at)
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT (org_id, LOWER(email)) DO NOTHING`,
          args: [
            invitation.memberId,
            invitation.orgId,
            email,
            role,
            Date.now(),
          ],
        });
      }
      await applyInvitationAppRoles(
        {
          appRolesJson,
          orgId: invitation.orgId,
          email,
          updatedBy: invitation.updatedBy,
        },
        tx,
      );
      const flipped = await tx.execute({
        sql: `UPDATE org_invitations SET status = 'accepted' WHERE id = ? AND status = 'pending'`,
        args: [invitation.invitationId],
      });
      if (Number(flipped.rowsAffected ?? 0) !== 1)
        throw new InvitationNoLongerLive();
      return true;
    })
    .catch((error: unknown) => {
      if (error instanceof InvitationNoLongerLive) return false;
      throw error;
    });
}
