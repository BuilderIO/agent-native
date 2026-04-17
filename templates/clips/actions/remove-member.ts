/**
 * Remove a member from a workspace.
 *
 * Admin-only. Rejects if the target is the last admin.
 *
 * Usage:
 *   pnpm action remove-member --workspaceId=<id> --email=alice@example.com
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { getCurrentOwnerEmail } from "../server/lib/recordings.js";

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
  throw new Error("Only workspace admins can remove members.");
}

export default defineAction({
  description:
    "Remove a member from a workspace. Admin-only. Rejects removing the last admin.",
  schema: z.object({
    workspaceId: z.string().describe("Workspace id"),
    email: z.string().email().describe("Member email"),
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

    if (target.role === "admin") {
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
          "Cannot remove the last admin. Promote another member to admin first.",
        );
      }
    }

    await db
      .delete(schema.workspaceMembers)
      .where(eq(schema.workspaceMembers.id, target.id));

    await writeAppState("refresh-signal", { ts: Date.now() });
    console.log(`Removed ${args.email} from workspace ${args.workspaceId}`);
    return { workspaceId: args.workspaceId, email: args.email, removed: true };
  },
});
