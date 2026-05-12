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
import { getDbExec } from "@agent-native/core/db";
import { z } from "zod";
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
    const exec = getDbExec();
    const { organizationId } = await requireOrganizationAccess(
      args.organizationId,
      ["admin"],
    );
    const targetEmailLower = args.email.toLowerCase();

    const targetRes = await exec.execute({
      sql: `SELECT role FROM org_members WHERE org_id = ? AND LOWER(email) = ? LIMIT 1`,
      args: [organizationId, targetEmailLower],
    });
    const target = (targetRes.rows as Array<{ role?: string }>)[0];
    if (!target) {
      throw new Error(`Member not found: ${args.email}`);
    }
    if (target.role === "owner") {
      throw new Error("Cannot remove the organization owner.");
    }

    await exec.execute({
      sql: `DELETE FROM org_members WHERE org_id = ? AND LOWER(email) = ?`,
      args: [organizationId, targetEmailLower],
    });

    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(`Removed ${args.email} from organization ${organizationId}`);
    return { organizationId, email: args.email, removed: true };
  },
});
