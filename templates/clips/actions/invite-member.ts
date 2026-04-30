/**
 * Invite an email address to the active organization.
 *
 * Creates an `invitation` row in the better-auth invitation table with a
 * 30-day expiry. Clips role mapping: `admin` → `admin`, everything else →
 * `member`. Returns the invitation id/token. Sends an email via the
 * framework email helper when a provider is configured — otherwise logs
 * the accept URL to the console.
 *
 * Usage:
 *   pnpm action invite-member --email=alice@example.com --role=admin
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { getDbExec, isPostgres } from "@agent-native/core/db";
import { emit } from "@agent-native/core/event-bus";
import {
  sendEmail,
  isEmailConfigured,
  renderEmail,
  emailStrong,
} from "@agent-native/core/server";
import { z } from "zod";
import {
  getCurrentOwnerEmail,
  nanoid,
  requireOrganizationAccess,
} from "../server/lib/recordings.js";

function getAppName(): string {
  return process.env.APP_NAME || "Clips";
}

// Accept the current better-auth role surface plus the old Clips roles for
// backwards-compatible CLI/agent calls. Legacy non-admin roles collapse to
// `member` when writing to better-auth.
const ClipsRoleEnum = z.enum([
  "viewer",
  "creator-lite",
  "creator",
  "member",
  "admin",
]);

function mapRole(role: z.infer<typeof ClipsRoleEnum>): "admin" | "member" {
  return role === "admin" ? "admin" : "member";
}

const DAY_MS = 24 * 60 * 60 * 1000;

function baseUrl(): string {
  return (
    process.env.APP_URL ||
    process.env.PUBLIC_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:8080"
  ).replace(/\/+$/, "");
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

async function fetchOrgName(organizationId: string): Promise<string> {
  const exec = getDbExec();
  const pg = isPostgres();
  const res = await exec.execute({
    sql: pg
      ? `SELECT name FROM organization WHERE id = $1 LIMIT 1`
      : `SELECT name FROM organization WHERE id = ? LIMIT 1`,
    args: [organizationId],
  });
  const row = (res.rows as Array<{ name?: string }>)[0];
  return row?.name ?? "Organization";
}

export default defineAction({
  description:
    "Invite someone to the active organization by email. Creates a pending invitation with a 30-day expiry. Role 'admin' maps to better-auth admin; all other Clips roles collapse to 'member'. Sends an email when a provider is configured.",
  schema: z.object({
    email: z.string().email().describe("Invitee email address"),
    role: ClipsRoleEnum.default("member").describe(
      "Role to assign when the invite is accepted",
    ),
  }),
  run: async (args) => {
    const exec = getDbExec();
    const pg = isPostgres();

    const { organizationId } = await requireOrganizationAccess(undefined, [
      "admin",
    ]);
    const inviter = getCurrentOwnerEmail();
    const inviterUserId = (await resolveUserId(inviter)) ?? inviter;
    const betterAuthRole = mapRole(args.role);

    // If there's already a pending invite for this email, rotate its id/expiry.
    const existingRes = await exec.execute({
      sql: pg
        ? `SELECT id FROM invitation WHERE organization_id = $1 AND email = $2 AND status = 'pending' LIMIT 1`
        : `SELECT id FROM invitation WHERE organization_id = ? AND email = ? AND status = 'pending' LIMIT 1`,
      args: [organizationId, args.email],
    });
    const existing = (existingRes.rows as Array<{ id?: string }>)[0];

    // better-auth's invitation table has no separate token column — the
    // invitation id IS the token (accept routes look up by id).
    const id = nanoid(24);
    const token = id;
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const expiresMs = nowMs + 30 * DAY_MS;
    const expiresIso = new Date(expiresMs).toISOString();

    if (existing?.id) {
      // Cancel the old pending row.
      await exec.execute({
        sql: pg
          ? `UPDATE invitation SET status = 'canceled', updated_at = NOW() WHERE id = $1`
          : `UPDATE invitation SET status = 'canceled', updated_at = ? WHERE id = ?`,
        args: pg ? [existing.id] : [nowMs, existing.id],
      });
    }

    if (pg) {
      await exec.execute({
        sql: `INSERT INTO invitation (id, organization_id, email, role, status, expires_at, inviter_id, created_at, updated_at)
              VALUES ($1, $2, $3, $4, 'pending', $5, $6, NOW(), NOW())`,
        args: [
          id,
          organizationId,
          args.email,
          betterAuthRole,
          expiresIso,
          inviterUserId,
        ],
      });
    } else {
      await exec.execute({
        sql: `INSERT INTO invitation (id, organization_id, email, role, status, expires_at, inviter_id, created_at, updated_at)
              VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
        args: [
          id,
          organizationId,
          args.email,
          betterAuthRole,
          expiresMs,
          inviterUserId,
          nowMs,
          nowMs,
        ],
      });
    }

    const orgName = await fetchOrgName(organizationId);
    const inviteUrl = `${baseUrl()}/invite/${token}`;

    const appName = getAppName() ?? "Clips";
    const { html, text } = renderEmail({
      preheader: `${inviter} invited you to ${orgName} on ${appName}.`,
      heading: `You're invited to join ${orgName}`,
      paragraphs: [
        `${emailStrong(inviter)} invited you to the ${emailStrong(orgName)} organization on ${emailStrong(appName)} as ${emailStrong(betterAuthRole)}.`,
        `Click the button below to accept the invite and start collaborating.`,
      ],
      cta: { label: "Accept invite", url: inviteUrl },
      footer: "This invite expires in 30 days.",
      brandColor: "#18181B",
    });
    try {
      await sendEmail({
        to: args.email,
        subject: `You're invited to ${orgName} on ${appName}`,
        html,
        text,
      });
    } catch (err) {
      console.warn("[invite-member] email send failed:", err);
    }

    await writeAppState("refresh-signal", { ts: Date.now() });

    // Emit clip.shared event — best-effort, never block the main flow.
    try {
      emit(
        "clip.shared",
        {
          sharedWith: args.email,
          sharedBy: inviter,
        },
        { owner: inviter },
      );
    } catch (err) {
      console.warn("[invite-member] clip.shared emit failed:", err);
    }

    console.log(`Invited ${args.email} to organization ${orgName}`);

    return {
      id,
      organizationId,
      email: args.email,
      role: betterAuthRole,
      status: "pending" as const,
      token,
      expiresAt: expiresIso,
      inviteUrl,
      emailConfigured: isEmailConfigured(),
    };
  },
});
