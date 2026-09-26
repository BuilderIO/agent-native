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
      return { accepted: [], activeOrgId: null };
    } else {
      throw error;
    }
  }

  if (rows.length === 0) {
    return { accepted: [], activeOrgId: null };
  }

  const accepted: AcceptPendingResult["accepted"] = [];
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
      // race's loser is a silent no-op instead of a thrown unique
      await db.execute({
        sql: `INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES (?, ?, ?, ?, ?)
              ON CONFLICT (org_id, LOWER(email)) DO NOTHING`,
        args: [nanoid(), inv.orgId, email, role, Date.now()],
      });
      invalidateMemberOrgCaches();
    }
    try {
      await applyInvitationAppRoles({
        appRolesJson: inv.appRolesJson,
        orgId: inv.orgId,
        email,
        updatedBy: inv.invitedBy,
      });
    } catch (error) {
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
    await Promise.race([Promise.all(telemetryPromises), sleep(1500)]);
  }

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
