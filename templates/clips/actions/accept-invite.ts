/**
 * Accept an organization invite.
 *
 * Verifies the invitation exists and is pending, inserts a row into the
 * better-auth `member` table for the current user, and marks the invitation
 * as accepted. Writes `refresh-signal` so the UI refetches lists.
 *
 * Usage:
 *   pnpm action accept-invite --token=<token>
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { getDbExec, isPostgres } from "@agent-native/core/db";
import { z } from "zod";
import { getCurrentOwnerEmail, nanoid } from "../server/lib/recordings.js";

interface InvitationRow {
  id: string;
  organization_id: string;
  email: string | null;
  role: string | null;
  status: string | null;
  expires_at: string | number | null;
}

function expiresInPast(v: string | number | null): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "number") return v < Date.now();
  if (/^\d+$/.test(String(v))) return Number(v) < Date.now();
  const t = new Date(v).getTime();
  return Number.isFinite(t) && t < Date.now();
}

async function resolveUserId(email: string): Promise<string | null> {
  const exec = getDbExec();
  try {
    const sql = isPostgres()
      ? `SELECT id FROM "user" WHERE email = $1 LIMIT 1`
      : `SELECT id FROM user WHERE email = ? LIMIT 1`;
    const res = await exec.execute({ sql, args: [email] });
    const row = (res.rows as Array<{ id?: string }>)[0];
    return row?.id ?? null;
  } catch {
    return null;
  }
}

export default defineAction({
  description:
    "Accept an organization invite. Inserts a member row for the current user with the invited role and marks the invitation as accepted.",
  schema: z.object({
    token: z.string().min(1).describe("Invite token (invitation id)"),
  }),
  run: async (args) => {
    const exec = getDbExec();
    const pg = isPostgres();
    const me = getCurrentOwnerEmail();

    const inviteRes = await exec.execute({
      sql: pg
        ? `SELECT id, organization_id, email, role, status, expires_at FROM invitation WHERE id = $1 LIMIT 1`
        : `SELECT id, organization_id, email, role, status, expires_at FROM invitation WHERE id = ? LIMIT 1`,
      args: [args.token],
    });
    const invite = (inviteRes.rows as InvitationRow[])[0];
    if (!invite) throw new Error("Invite not found.");
    if (invite.status === "accepted")
      throw new Error("Invite already accepted.");
    if (invite.status === "rejected" || invite.status === "canceled")
      throw new Error("Invite is no longer valid.");
    if (expiresInPast(invite.expires_at))
      throw new Error("Invite has expired.");

    const userId = (await resolveUserId(me)) ?? me;
    const role: "admin" | "member" =
      invite.role === "admin" ? "admin" : "member";
    const nowMs = Date.now();

    // Skip if the user already has a member row for this org.
    const existsRes = await exec.execute({
      sql: pg
        ? `SELECT id FROM member WHERE organization_id = $1 AND user_id = $2 LIMIT 1`
        : `SELECT id FROM member WHERE organization_id = ? AND user_id = ? LIMIT 1`,
      args: [invite.organization_id, userId],
    });

    if (!(existsRes.rows as any[]).length) {
      const memberId = nanoid();
      if (pg) {
        await exec.execute({
          sql: `INSERT INTO member (id, organization_id, user_id, role, created_at, updated_at) VALUES ($1, $2, $3, $4, NOW(), NOW())`,
          args: [memberId, invite.organization_id, userId, role],
        });
      } else {
        await exec.execute({
          sql: `INSERT INTO member (id, organization_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
          args: [memberId, invite.organization_id, userId, role, nowMs, nowMs],
        });
      }
    }

    if (pg) {
      await exec.execute({
        sql: `UPDATE invitation SET status = 'accepted', updated_at = NOW() WHERE id = $1`,
        args: [invite.id],
      });
    } else {
      await exec.execute({
        sql: `UPDATE invitation SET status = 'accepted', updated_at = ? WHERE id = ?`,
        args: [nowMs, invite.id],
      });
    }

    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(
      `Accepted invite for ${me} into organization ${invite.organization_id}`,
    );
    return {
      organizationId: invite.organization_id,
      email: me,
      role,
    };
  },
});
