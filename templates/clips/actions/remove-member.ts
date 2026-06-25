/**
 * Remove a member from the active organization.
 *
 * Admin-only. Refuses to remove the organization owner.
 *
 * Usage:
 *   pnpm action remove-member --email=alice@example.com
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { orgMembers } from "@agent-native/core/org";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { requireOrganizationAccess } from "../server/lib/recordings.js";

export default defineAction({
  description:
    "Remove a member from the active organization. Admin-only. Refuses to remove the owner.",
  schema: z.object({
    organizationId: z
      .string()
      .optional()
      .describe("Organization id (defaults to the caller's active org)"),
    email: z.string().email().describe("Member email"),
  }),
  run: async (args) => {
    const db = getDb();
    const { organizationId } = await requireOrganizationAccess(
      args.organizationId,
      ["admin"],
    );
    const targetEmailLower = args.email.toLowerCase();

    const [target] = await db
      .select({ role: orgMembers.role })
      .from(orgMembers)
      .where(
        and(
          eq(orgMembers.orgId, organizationId),
          sql`lower(${orgMembers.email}) = ${targetEmailLower}`,
        ),
      )
      .limit(1);
    if (!target) {
      throw new Error(`Member not found: ${args.email}`);
    }
    if (target.role === "owner") {
      throw new Error("Cannot remove the organization owner.");
    }

    await db
      .delete(orgMembers)
      .where(
        and(
          eq(orgMembers.orgId, organizationId),
          sql`lower(${orgMembers.email}) = ${targetEmailLower}`,
        ),
      );

    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(`Removed ${args.email} from organization ${organizationId}`);
    return { organizationId, email: args.email, removed: true };
  },
});
