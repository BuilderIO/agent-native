/**
 * Invite an email address to the active organization.
 *
 * Creates an `org_invitations` row with status `pending`. Clips role mapping:
 * `admin` → `admin`, everything else → `member`. Returns the invitation id
 * (which is the accept token). Sends an email via the framework email helper
 * when a provider is configured.
 *
 * Usage:
 *   pnpm action invite-member --email=alice@example.com --role=admin
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { getDbExec } from "@agent-native/core/db";
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

// Accept the current admin/member surface plus legacy Clips roles for
// backwards-compatible CLI/agent calls. Legacy non-admin roles collapse to
// `member`.
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

function baseUrl(): string {
  return (
    process.env.APP_URL ||
    process.env.PUBLIC_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:8080"
  ).replace(/\/+$/, "");
}

async function fetchOrgName(orgId: string): Promise<string> {
  const exec = getDbExec();
  const res = await exec.execute({
    sql: `SELECT name FROM organizations WHERE id = ? LIMIT 1`,
    args: [orgId],
  });
  const row = (res.rows as Array<{ name?: string }>)[0];
  return row?.name ?? "Organization";
}

export default defineAction({
  description:
    "Invite someone to the active organization by email. Creates a pending invitation. Role 'admin' maps to admin; all other Clips roles collapse to 'member'. Sends an email when a provider is configured.",
  schema: z.object({
    email: z.string().email().describe("Invitee email address"),
    role: ClipsRoleEnum.default("member").describe(
      "Role to assign when the invite is accepted",
    ),
  }),
  run: async (args) => {
    const exec = getDbExec();

    const { organizationId } = await requireOrganizationAccess(undefined, [
      "admin",
    ]);
    const inviter = getCurrentOwnerEmail();
    const role = mapRole(args.role);
    const inviteeEmail = args.email.trim().toLowerCase();

    // Rotate any existing pending invite for this email so the latest one is
    // the only live token.
    const existingRes = await exec.execute({
      sql: `SELECT id FROM org_invitations WHERE org_id = ? AND LOWER(email) = ? AND status = 'pending' LIMIT 1`,
      args: [organizationId, inviteeEmail],
    });
    const existing = (existingRes.rows as Array<{ id?: string }>)[0];
    if (existing?.id) {
      await exec.execute({
        sql: `UPDATE org_invitations SET status = 'canceled' WHERE id = ?`,
        args: [existing.id],
      });
    }

    const id = nanoid(24);
    const token = id;
    const nowMs = Date.now();

    await exec.execute({
      sql: `INSERT INTO org_invitations (id, org_id, email, invited_by, created_at, status, role) VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
      args: [id, organizationId, args.email, inviter, nowMs, role],
    });

    const orgName = await fetchOrgName(organizationId);
    const inviteUrl = `${baseUrl()}/invite/${token}`;

    const appName = getAppName();
    const { html, text } = renderEmail({
      preheader: `${inviter} invited you to ${orgName} on ${appName}.`,
      heading: `You're invited to join ${orgName}`,
      paragraphs: [
        `${emailStrong(inviter)} invited you to the ${emailStrong(orgName)} organization on ${emailStrong(appName)} as ${emailStrong(role)}.`,
        `Click the button below to accept the invite and start collaborating.`,
      ],
      cta: { label: "Accept invite", url: inviteUrl },
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

    try {
      emit(
        "clip.shared",
        { sharedWith: args.email, sharedBy: inviter },
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
      role,
      status: "pending" as const,
      token,
      inviteUrl,
      emailConfigured: isEmailConfigured(),
    };
  },
});
