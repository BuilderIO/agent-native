/**
 * Update a workspace member's role.
 *
 * Admin-only. Rejects the change when it would remove the last admin from
 * the workspace.
 *
 * Usage:
 *   pnpm action update-member-role --workspaceId=<id> --email=alice@example.com --role=admin
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { getCurrentOwnerEmail } from "../server/lib/recordings.js";

const RoleEnum = z.enum(["viewer", "creator-lite", "creator", "admin"]);

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
  throw new Error("Only workspace admins can change member roles.");
}

export default defineAction({
  description:
    "Change a workspace member's role. Admin-only. Rejects changes that would remove the last admin.",
  schema: z.object({
    workspaceId: z.string().describe("Workspace id"),
    email: z.string().email().describe("Member email"),
    role: RoleEnum.describe("New role"),
  }),
  run: async (args) => {
    const db = getDb();
    const caller = getCurrentOwnerEmail();
    await assertCallerIsAdmin(args.workspaceId, caller);

    const [target] = await db
      .select()
      .from(schema.workspaceMembers)
      .where(
        and(
          eq(schema.workspaceMembers.workspaceId, args.workspaceId),
          eq(schema.workspaceMembers.email, args.email),
        ),
      );
    if (!target) {
      throw new Error(`Member not found: ${args.email}`);
    }

    // Last-admin guard — refuse to demote the only admin.
    if (target.role === "admin" && args.role !== "admin") {
      const admins = await db
        .select({ id: schema.workspaceMembers.id })
        .from(schema.workspaceMembers)
        .where(
          and(
            eq(schema.workspaceMembers.workspaceId, args.workspaceId),
            eq(schema.workspaceMembers.role, "admin"),
          ),
        );
      if (admins.length <= 1) {
        throw new Error(
          "Cannot demote the last admin. Promote another member to admin first.",
        );
      }
    }

    await db
      .update(schema.workspaceMembers)
      .set({ role: args.role })
      .where(eq(schema.workspaceMembers.id, target.id));

    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(
      `Updated role for ${args.email} in workspace ${args.workspaceId} to ${args.role}`,
    );

    return {
      workspaceId: args.workspaceId,
      email: args.email,
      role: args.role,
    };
  },
});
