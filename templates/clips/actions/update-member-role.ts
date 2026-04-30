/**
 * Update an organization member's role.
 *
 * Admin-only. Clips role mapping collapses to better-auth's two-tier model:
 *   admin → admin, anything else → member.
 *
 * Usage:
 *   pnpm action update-member-role --email=alice@example.com --role=admin
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { getDbExec, isPostgres } from "@agent-native/core/db";
import { z } from "zod";
import { requireActiveOrganizationId } from "../server/lib/recordings.js";

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
    "Change an organization member's role. Admin-only. Clips role 'admin' maps to better-auth admin; all other roles collapse to 'member'.",
  schema: z.object({
    organizationId: z
      .string()
      .optional()
      .describe("Organization id (defaults to the caller's active org)"),
    email: z.string().email().describe("Member email"),
    role: ClipsRoleEnum.describe("New role"),
  }),
  run: async (args) => {
    const exec = getDbExec();
    const pg = isPostgres();
    const organizationId =
      args.organizationId || (await requireActiveOrganizationId());
    const betterAuthRole = mapRole(args.role);

    // Verify the target member exists.
    const existsRes = await exec.execute({
      sql: pg
        ? `SELECT m.id FROM member m JOIN "user" u ON u.id = m.user_id WHERE m.organization_id = $1 AND u.email = $2 LIMIT 1`
        : `SELECT m.id FROM member m JOIN user u ON u.id = m.user_id WHERE m.organization_id = ? AND u.email = ? LIMIT 1`,
      args: [organizationId, args.email],
    });
    if (!(existsRes.rows as any[]).length) {
      throw new Error(`Member not found: ${args.email}`);
    }

    // Last-admin guard — refuse to demote the only admin.
    if (betterAuthRole !== "admin") {
      const adminsRes = await exec.execute({
        sql: pg
          ? `SELECT COUNT(*) AS count FROM member WHERE organization_id = $1 AND role = 'admin'`
          : `SELECT COUNT(*) AS count FROM member WHERE organization_id = ? AND role = 'admin'`,
        args: [organizationId],
      });
      const adminCount = Number((adminsRes.rows as any[])[0]?.count ?? 0);
      // Check whether THIS user is currently admin — if yes and they're the
      // only admin, refuse.
      const targetRoleRes = await exec.execute({
        sql: pg
          ? `SELECT m.role FROM member m JOIN "user" u ON u.id = m.user_id WHERE m.organization_id = $1 AND u.email = $2 LIMIT 1`
          : `SELECT m.role FROM member m JOIN user u ON u.id = m.user_id WHERE m.organization_id = ? AND u.email = ? LIMIT 1`,
        args: [organizationId, args.email],
      });
      const currentRole = (targetRoleRes.rows as Array<{ role?: string }>)[0]
        ?.role;
      if (currentRole === "admin" && adminCount <= 1) {
        throw new Error(
          "Cannot demote the last admin. Promote another member to admin first.",
        );
      }
    }

    const nowMs = Date.now();
    if (pg) {
      await exec.execute({
        sql: `UPDATE member SET role = $1, updated_at = NOW() WHERE organization_id = $2 AND user_id = (SELECT id FROM "user" WHERE email = $3)`,
        args: [betterAuthRole, organizationId, args.email],
      });
    } else {
      await exec.execute({
        sql: `UPDATE member SET role = ?, updated_at = ? WHERE organization_id = ? AND user_id = (SELECT id FROM user WHERE email = ?)`,
        args: [betterAuthRole, nowMs, organizationId, args.email],
      });
    }

    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(
      `Updated role for ${args.email} in organization ${organizationId} to ${betterAuthRole}`,
    );

    return {
      organizationId,
      email: args.email,
      role: betterAuthRole,
    };
  },
});
