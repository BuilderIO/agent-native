/**
 * Update a workspace member's role. Admin-only. Rejects demoting the last
 * admin.
 *
 * Usage:
 *   pnpm action update-member-role --workspaceId=<id> --email=alice@example.com --role=admin
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
import {
  writeAppState,
  readAppState,
} from "@agent-native/core/application-state";

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
  http: { method: "POST" },
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
    if (!target) throw new Error(`Member not found: ${args.email}`);

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

void nanoid;
void parseSpaceIds;
void stringifySpaceIds;
void parseJson;
void resolveDefaultWorkspaceId;
void readAppState;
void accessFilter;
void assertAccess;
