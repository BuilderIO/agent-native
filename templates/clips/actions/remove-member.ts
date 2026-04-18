/**
 * Remove a member from the active organization.
 *
 * Admin-only. Rejects if the target is the last admin.
 *
 * Usage:
 *   pnpm action remove-member --email=alice@example.com
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { getDbExec, isPostgres } from "@agent-native/core/db";
import { z } from "zod";
import { requireActiveOrganizationId } from "../server/lib/recordings.js";

export default defineAction({
  description:
    "Remove a member from the active organization. Admin-only. Rejects removing the last admin.",
  schema: z.object({
    organizationId: z
      .string()
      .optional()
      .describe("Organization id (defaults to the caller's active org)"),
    email: z.string().email().describe("Member email"),
  }),
  run: async (args) => {
    const exec = getDbExec();
    const pg = isPostgres();
    const organizationId =
      args.organizationId || (await requireActiveOrganizationId());

    // Check the target exists and get their role.
    const targetRes = await exec.execute({
      sql: pg
        ? `SELECT m.id, m.role FROM member m JOIN "user" u ON u.id = m.user_id WHERE m.organization_id = $1 AND u.email = $2 LIMIT 1`
        : `SELECT m.id, m.role FROM member m JOIN user u ON u.id = m.user_id WHERE m.organization_id = ? AND u.email = ? LIMIT 1`,
      args: [organizationId, args.email],
    });
    const target = (targetRes.rows as Array<{ id?: string; role?: string }>)[0];
    if (!target) {
      throw new Error(`Member not found: ${args.email}`);
    }

    if (target.role === "admin") {
      const adminsRes = await exec.execute({
        sql: pg
          ? `SELECT COUNT(*) AS count FROM member WHERE organization_id = $1 AND role = 'admin'`
          : `SELECT COUNT(*) AS count FROM member WHERE organization_id = ? AND role = 'admin'`,
        args: [organizationId],
      });
      const adminCount = Number((adminsRes.rows as any[])[0]?.count ?? 0);
      if (adminCount <= 1) {
        throw new Error(
          "Cannot remove the last admin. Promote another member to admin first.",
        );
      }
    }

    if (pg) {
      await exec.execute({
        sql: `DELETE FROM member WHERE organization_id = $1 AND user_id = (SELECT id FROM "user" WHERE email = $2)`,
        args: [organizationId, args.email],
      });
    } else {
      await exec.execute({
        sql: `DELETE FROM member WHERE organization_id = ? AND user_id = (SELECT id FROM user WHERE email = ?)`,
        args: [organizationId, args.email],
      });
    }

    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(`Removed ${args.email} from organization ${organizationId}`);
    return { organizationId, email: args.email, removed: true };
  },
});
