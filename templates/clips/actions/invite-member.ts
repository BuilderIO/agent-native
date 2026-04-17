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
import {
  sendEmail,
  isEmailConfigured,
  renderEmail,
  emailStrong,
} from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { getCurrentOwnerEmail, nanoid } from "../server/lib/recordings.js";

function getAppName(): string {
  return process.env.APP_NAME || "Clips";
}

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
    const { html, text } = renderEmail({
      preheader: `${inviter} invited you to ${workspaceName} on ${appName}.`,
      heading: `You're invited to join ${workspaceName}`,
      paragraphs: [
        `${emailStrong(inviter)} invited you to the ${emailStrong(workspaceName)} workspace on ${emailStrong(appName)} as ${emailStrong(args.role)}.`,
        `Click the button below to accept the invite and start collaborating.`,
      ],
      cta: { label: "Accept invite", url: inviteUrl },
      footer: "This invite expires in 7 days.",
      brandColor: "#625DF5",
    });
    try {
      await sendEmail({
        to: args.email,
        subject: `You're invited to ${workspaceName} on ${appName}`,
        html,
        text,
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
