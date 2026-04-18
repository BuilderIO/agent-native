/**
 * Invite an email address to a workspace. Creates an `invites` row with a
 * unique token and 7-day expiry. Returns the invite URL `/invite/<token>`.
 *
 * Usage:
 *   pnpm action invite-member --workspaceId=<id> --email=alice@example.com --role=creator
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import {
  getCurrentOwnerEmail,
  nanoid,
  parseSpaceIds,
  stringifySpaceIds,
  parseJson,
  resolveDefaultWorkspaceId,
} from "../server/lib/calls.js";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { writeAppState, readAppState } from "@agent-native/core/application-state";

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
    "Invite someone to a workspace by email. Creates an invites row with a unique token and 7-day expiry. Returns an invite URL `/invite/<token>` (rotates the token if an unaccepted invite already exists for this email).",
  schema: z.object({
    workspaceId: z.string().describe("Workspace to invite into"),
    email: z.string().email().describe("Invitee email address"),
    role: RoleEnum.default("creator").describe("Role to assign when accepted"),
  }),
  http: { method: "POST" },
  run: async (args) => {
    const db = getDb();
    const inviter = getCurrentOwnerEmail();
    await assertCallerIsAdmin(args.workspaceId, inviter);

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
    } else {
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
    }

    await writeAppState("refresh-signal", { ts: Date.now() });

    const inviteUrl = `${baseUrl()}/invite/${token}`;
    console.log(`Invited ${args.email} to workspace ${args.workspaceId}`);

    return {
      id,
      workspaceId: args.workspaceId,
      email: args.email,
      role: args.role,
      token,
      expiresAt,
      inviteUrl,
    };
  },
});

void parseSpaceIds;
void stringifySpaceIds;
void parseJson;
void resolveDefaultWorkspaceId;
void readAppState;
void accessFilter;
void assertAccess;
