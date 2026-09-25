import { getDbExec } from "../db/client.js";
import { evaluateFeatureFlagStrict } from "../feature-flags/store.js";
import { setActiveOrgId } from "./active-org.js";
import { applyInvitationAppRoles } from "./app-roles.js";
import { CROSS_APP_ORG_FEDERATION_FLAG } from "./feature-flags.js";
import { isMissingOrganizationTableError } from "./membership.js";
import { invalidateMemberOrgCaches } from "./request-org-cache.js";
import { trackInviteAccepted } from "./track-invite-accepted.js";

const nanoid = (): string =>
  globalThis.crypto?.randomUUID?.().replace(/-/g, "") ??
  Math.random().toString(36).slice(2) + Date.now().toString(36);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isMissingInvitationTableError(error: unknown): boolean {
  const candidate = error as { message?: unknown };
  return /no such table:\s*["'`]?org_invitations["'`]?|relation\s+["'`]?org_invitations["'`]?\s+does not exist/i.test(
    String(candidate?.message ?? error),
  );
}

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
 * org module) — it swallows the missing-relation error and returns empty.
 */
export async function acceptPendingInvitationsForEmail(
  rawEmail: string,
): Promise<AcceptPendingResult> {
  const email = rawEmail.trim().toLowerCase();
  if (!email) {
    return { accepted: [], activeOrgId: null };
  }

  const db = getDbExec();

  let rows: Array<{
    id: string;
    orgId: string;
    role: string | null;
    invitedBy: string;
    appRolesJson: string | null;
    federated: boolean;
  }> = [];
  try {
    const res = await db.execute({
      sql: `SELECT i.id, i.org_id AS "orgId", i.role, i.invited_by AS "invitedBy", i.app_roles_json AS "appRolesJson",
                   o.identity_authority AS "identityAuthority",
                   o.identity_id AS "identityId"
            FROM org_invitations i
            LEFT JOIN organizations o ON o.id = i.org_id
            WHERE LOWER(i.email) = ? AND i.status = 'pending'
            ORDER BY i.created_at DESC`,
      args: [email],
    });
    rows = res.rows.map((r: any) => ({
      id: String(r.id),
      orgId: String(r.orgId ?? r.org_id),
      role: r.role == null ? null : String(r.role),
      invitedBy: String(r.invitedBy ?? r.invited_by ?? ""),
      appRolesJson: r.appRolesJson == null ? null : String(r.appRolesJson),
      federated: Boolean(
        String(r.identityAuthority ?? r.identity_authority ?? "").trim() &&
        String(r.identityId ?? r.identity_id ?? "").trim(),
      ),
    }));
  } catch (error) {
    if (isMissingOrganizationTableError(error)) {
      const res = await db.execute({
        sql: `SELECT i.id, i.org_id AS "orgId", i.role, i.invited_by AS "invitedBy", i.app_roles_json AS "appRolesJson"
              FROM org_invitations i
              WHERE LOWER(i.email) = ? AND i.status = 'pending'
              ORDER BY i.created_at DESC`,
        args: [email],
      });
      rows = res.rows.map((r: any) => ({
        id: String(r.id),
        orgId: String(r.orgId ?? r.org_id),
        role: r.role == null ? null : String(r.role),
        invitedBy: String(r.invitedBy ?? r.invited_by ?? ""),
        appRolesJson: r.appRolesJson == null ? null : String(r.appRolesJson),
        federated: false,
      }));
    } else if (isMissingInvitationTableError(error)) {
      // Template doesn't use the org module.
      return { accepted: [], activeOrgId: null };
    } else {
      throw error;
    }
  }

  if (rows.length === 0) {
    return { accepted: [], activeOrgId: null };
  }

  const accepted: AcceptPendingResult["accepted"] = [];
  // Callers here are signup/SSO hooks with no request event to register a
  // `waitUntil` with, and a serverless function can freeze as soon as the
  // response flushes. A short bounded wait keeps `invite_accepted` from being
  // dropped without adding more than one fixed delay to signup.
  const telemetryPromises: Promise<void>[] = [];
  for (const inv of rows) {
    if (inv.federated) {
      let federationEnabled = false;
      try {
        federationEnabled = await evaluateFeatureFlagStrict(
          CROSS_APP_ORG_FEDERATION_FLAG.key,
          {
            userEmail: email,
            userKey: email,
            orgId: inv.orgId,
          },
        );
      } catch {
        // A linked org must not fall back to accepting a local invitation
        // while rollout state is unreadable.
        continue;
      }
      if (federationEnabled) continue;
    }
    const existing = await db.execute({
      sql: `SELECT federation_removal_pending_at FROM org_members
            WHERE org_id = ? AND LOWER(email) = ? LIMIT 1`,
      args: [inv.orgId, email],
    });
    if ((existing.rows[0] as any)?.federation_removal_pending_at) continue;
    if (existing.rows.length === 0) {
      const role = inv.role === "admin" ? "admin" : "member";
      // The SELECT above is a cheap pre-check, not a correctness guard —
      // two concurrent acceptances (e.g. a retried signup hook) can both
      // pass it before either INSERT commits. `ON CONFLICT (org_id,
      // LOWER(email)) DO NOTHING` targets the unique expression index
      // added in migrations.ts (org-members-unique-lower-email-idx) so the
      // race's loser is a silent no-op instead of a thrown unique
      // constraint violation or a duplicate row.
      await db.execute({
        sql: `INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES (?, ?, ?, ?, ?)
              ON CONFLICT (org_id, LOWER(email)) DO NOTHING`,
        args: [nanoid(), inv.orgId, email, role, Date.now()],
      });
      invalidateMemberOrgCaches();
    }
    // Keep the invitation pending when a pre-assigned role cannot be applied.
    // The auth hook logs the retryable failure while membership remains safe
    // to reuse on the next reconciliation attempt.
    try {
      await applyInvitationAppRoles({
        appRolesJson: inv.appRolesJson,
        orgId: inv.orgId,
        email,
        updatedBy: inv.invitedBy,
      });
    } catch (error) {
      // Keep this invitation pending so a corrected assignment can be retried
      // without preventing unrelated invitations from being accepted.
      console.warn(
        `[org] Could not apply app roles for invitation ${inv.id}; leaving it pending`,
        error,
      );
      continue;
    }
    const updated = await db.execute({
      sql: `UPDATE org_invitations SET status = 'accepted' WHERE id = ? AND status = 'pending'`,
      args: [inv.id],
    });
    if (Number(updated.rowsAffected ?? 0) !== 1) continue;
    accepted.push({ invitationId: inv.id, orgId: inv.orgId });
    telemetryPromises.push(
      trackInviteAccepted({
        email,
        orgId: inv.orgId,
        role: inv.role,
        invitedBy: inv.invitedBy,
        federated: inv.federated,
      }),
    );
  }

  if (telemetryPromises.length > 0) {
    // One bounded wait total, not one per invitation, capped like
    // `flushSignupTracking`. Each promise includes the provider flush; a cap
    // cannot guarantee delivery, it only bounds what signup pays for it.
    await Promise.race([Promise.all(telemetryPromises), sleep(1500)]);
  }

  // Set active-org-id to the most recent invite so the user lands in a
  // populated workspace on first load.
  const activeOrgId = accepted[0]?.orgId ?? null;
  if (activeOrgId) {
    try {
      await setActiveOrgId(email, activeOrgId, "accepted pending invitation");
    } catch {
      // user_settings table might not exist in a minimal template — not fatal.
    }
  }

  return { accepted, activeOrgId };
}
