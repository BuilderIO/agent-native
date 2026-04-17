/**
 * Invite an email address to a workspace.
 *
 * Creates an `invites` row with a unique token and 7-day expiry. Returns the
 * invite URL `/invite/<token>`. Sends an email via the framework email helper
 * when a provider is configured — otherwise logs the link to the console so
 * the flow still works end-to-end locally.
 *
 * Usage:
 *   pnpm action invite-member --workspaceId=<id> --email=alice@example.com --role=creator
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { getCurrentOwnerEmail, nanoid } from "../server/lib/recordings.js";
import { isEmailConfigured, sendEmail } from "@agent-native/core/server/email";
import { getAppName } from "@agent-native/core/server/app-name";

const RoleEnum = z.enum(["viewer", "creator-lite", "creator", "admin"]);

const DAY_MS = 24 * 60 * 60 * 1000;

async function assertCallerIsAdmin(workspaceId: string, email: string) {
  const db = getDb();
  const [member] = await db
    .select()
    .from(schema.workspaceMembers)
    .where(
      and(
        eq(schema.workspaceMembers.workspaceId, workspaceId),
        eq(schema.workspaceMembers.email, email),
      ),
    );
  // Owner of the workspace is implicitly admin even if no row exists yet.
  if (member && member.role === "admin") return;
  const [ws] = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId));
  if (!ws) throw new Error(`Workspace not found: ${workspaceId}`);
  if (ws.ownerEmail === email) return;
  throw new Error("Only workspace admins can invite members.");
}

function inviteEmailHtml(args: {
  inviterEmail: string;
  workspaceName: string;
  role: string;
  appName: string;
  inviteUrl: string;
}): string {
  return `
<!DOCTYPE html>
<html>
  <body style="font-family: Inter, -apple-system, BlinkMacSystemFont, sans-serif; background:#f7f7f9; padding:32px; color:#111827;">
    <div style="max-width:520px; margin:auto; background:#ffffff; border-radius:12px; padding:32px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
      <div style="display:flex; align-items:center; gap:10px; margin-bottom:20px;">
        <div style="width:32px; height:32px; border-radius:8px; background:#625DF5; color:white; display:inline-flex; align-items:center; justify-content:center; font-weight:700;">${args.appName.slice(0, 1)}</div>
        <div style="font-weight:600;">${args.appName}</div>
      </div>
      <h1 style="font-size:22px; margin:0 0 12px 0;">You're invited to join ${escapeHtml(args.workspaceName)}</h1>
      <p style="line-height:1.5; margin:0 0 8px 0;"><strong>${escapeHtml(args.inviterEmail)}</strong> invited you to the <strong>${escapeHtml(args.workspaceName)}</strong> workspace on ${args.appName} as <strong>${escapeHtml(args.role)}</strong>.</p>
      <p style="line-height:1.5; margin:0 0 24px 0;">Click the button below to accept the invite and start collaborating.</p>
      <a href="${args.inviteUrl}" style="display:inline-block; background:#625DF5; color:white; padding:12px 18px; border-radius:8px; text-decoration:none; font-weight:600;">Accept invite</a>
      <p style="color:#6b7280; font-size:13px; margin-top:24px;">Or paste this link into your browser: <br/><a href="${args.inviteUrl}" style="color:#625DF5; word-break:break-all;">${args.inviteUrl}</a></p>
      <p style="color:#9ca3af; font-size:12px; margin-top:24px;">This invite expires in 7 days.</p>
    </div>
  </body>
</html>
`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function baseUrl(): string {
  return (
    process.env.APP_URL ||
    process.env.PUBLIC_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:8080"
  ).replace(/\/+$/, "");
}

export default defineAction({
  description:
    "Invite someone to a workspace by email. Creates an invites row with a unique token and 7-day expiry. Returns an invite URL and optionally sends the invite email (Resend/SendGrid if configured; otherwise logs to console).",
  schema: z.object({
    workspaceId: z.string().describe("Workspace to invite into"),
    email: z.string().email().describe("Invitee email address"),
    role: RoleEnum.default("creator").describe("Role to assign when accepted"),
  }),
  run: async (args) => {
    const db = getDb();
    const inviter = getCurrentOwnerEmail();

    await assertCallerIsAdmin(args.workspaceId, inviter);

    // Reject if the email is already an active member.
    const [existingMember] = await db
      .select()
      .from(schema.workspaceMembers)
      .where(
        and(
          eq(schema.workspaceMembers.workspaceId, args.workspaceId),
          eq(schema.workspaceMembers.email, args.email),
        ),
      );
    if (existingMember) {
      throw new Error(`${args.email} is already a member of this workspace.`);
    }

    // If there's an existing unaccepted invite, rotate its token/expiry.
    const [existing] = await db
      .select()
      .from(schema.invites)
      .where(
        and(
          eq(schema.invites.workspaceId, args.workspaceId),
          eq(schema.invites.email, args.email),
        ),
      );

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * DAY_MS).toISOString();
    const token = nanoid(24);
    const id = existing?.id ?? nanoid();

    if (existing && !existing.acceptedAt) {
      await db
        .update(schema.invites)
        .set({
          token,
          role: args.role,
          invitedBy: inviter,
          expiresAt,
          acceptedAt: null,
          createdAt: now.toISOString(),
        })
        .where(eq(schema.invites.id, existing.id));
    } else if (!existing) {
      await db.insert(schema.invites).values({
        id,
        workspaceId: args.workspaceId,
        email: args.email,
        role: args.role,
        token,
        invitedBy: inviter,
        expiresAt,
        createdAt: now.toISOString(),
      });
    } else {
      // Previously accepted — issue a new invite row.
      await db.insert(schema.invites).values({
        id: nanoid(),
        workspaceId: args.workspaceId,
        email: args.email,
        role: args.role,
        token,
        invitedBy: inviter,
        expiresAt,
        createdAt: now.toISOString(),
      });
    }

    const [ws] = await db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, args.workspaceId));
    const workspaceName = ws?.name ?? "Workspace";

    const inviteUrl = `${baseUrl()}/invite/${token}`;

    // Fire-and-forget email send. We don't want a transient email failure
    // to wipe the invite row — the invite URL is still usable.
    const appName = getAppName() ?? "Clips";
    const html = inviteEmailHtml({
      inviterEmail: inviter,
      workspaceName,
      role: args.role,
      appName,
      inviteUrl,
    });
    try {
      await sendEmail({
        to: args.email,
        subject: `You're invited to ${workspaceName} on ${appName}`,
        html,
        text: `${inviter} invited you to ${workspaceName} on ${appName} as ${args.role}. Accept: ${inviteUrl}`,
      });
    } catch (err) {
      console.warn("[invite-member] email send failed:", err);
    }

    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(`Invited ${args.email} to workspace ${workspaceName}`);

    return {
      id,
      workspaceId: args.workspaceId,
      email: args.email,
      role: args.role,
      token,
      expiresAt,
      inviteUrl,
      emailConfigured: isEmailConfigured(),
    };
  },
});
