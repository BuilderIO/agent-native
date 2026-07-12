/**
 * Update an organization member's role.
 *
 * Admin-only. Clips role mapping collapses to two invitable roles:
 *   admin → admin, anything else → member.
 * Refuses to change the owner's role.
 *
 * Usage:
 *   pnpm action update-member-role --email=alice@example.com --role=admin
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { orgMembers } from "@agent-native/core/org";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { requireOrganizationAccess } from "../server/lib/recordings.js";

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

export default defineAction({
  description:
    "Change an organization member's role. Admin-only. Clips role 'admin' maps to admin; all other roles collapse to 'member'. Cannot change the owner's role.",
  schema: z.object({
    organizationId: z
      .string()
      .optional()
      .describe("Organization id (defaults to the caller's active org)"),
    email: z.string().email().describe("Member email"),
    role: ClipsRoleEnum.describe("New role"),
  }),
  run: async (args) => {
    const db = getDb();
    const { organizationId } = await requireOrganizationAccess(
      args.organizationId,
      ["admin"],
    );
    const role = mapRole(args.role);
    const targetEmailLower = args.email.toLowerCase();

    const [existing] = await db
      .select({ role: orgMembers.role })
      .from(orgMembers)
      .where(
        and(
          eq(orgMembers.orgId, organizationId),
          sql`lower(${orgMembers.email}) = ${targetEmailLower}`,
        ),
      )
      .limit(1);
    if (!existing) {
      throw new Error(`Member not found: ${args.email}`);
    }
    if (existing.role === "owner") {
      throw new Error("Cannot change the organization owner's role.");
    }

    await db
      .update(orgMembers)
      .set({ role })
      .where(
        and(
          eq(orgMembers.orgId, organizationId),
          sql`lower(${orgMembers.email}) = ${targetEmailLower}`,
        ),
      );

    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(
      `Updated role for ${args.email} in organization ${organizationId} to ${role}`,
    );

    return {
      organizationId,
      email: args.email,
      role,
    };
  },
});
