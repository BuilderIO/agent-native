import { defineAction } from "@agent-native/core";
import {
  accessFilter,
  resolveAccess,
  type ShareRole,
} from "@agent-native/core/sharing";
import { desc } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

function canManageRole(role: "owner" | ShareRole) {
  return role === "owner" || role === "admin";
}

export default defineAction({
  description:
    "List all design systems accessible to the current user. " +
    "Returns title, id, and whether each is the default.",
  schema: z.object({
    compact: z
      .enum(["true", "false"])
      .optional()
      .describe("Set to 'true' for compact output (id, title, isDefault only)"),
  }),
  readOnly: true,
  http: { method: "GET" },
  run: async (args) => {
    const db = getDb();
    const rows = await db
      .select()
      .from(schema.designSystems)
      .where(accessFilter(schema.designSystems, schema.designSystemShares))
      .orderBy(desc(schema.designSystems.updatedAt));

    if (rows.length === 0) {
      return { count: 0, designSystems: [] };
    }

    const accessById = new Map<
      string,
      { role: "owner" | ShareRole; canManage: boolean }
    >();
    await Promise.all(
      rows.map(async (row) => {
        const access = await resolveAccess("design-system", row.id);
        if (!access) {
          // accessFilter admitted this row but resolveAccess cannot name a
          // role, so create-design's assertAccess will reject the same id the
          // picker just offered.
          console.warn(
            `[design] list-design-systems: no resolvable access for ` +
              `design-system ${row.id} ("${row.title}") that accessFilter ` +
              `admitted; create-design will reject it.`,
          );
        }
        const role = access?.role ?? "viewer";
        accessById.set(row.id, { role, canManage: canManageRole(role) });
      }),
    );

    const items = rows.map((row) => {
      const access = accessById.get(row.id) ?? {
        role: "viewer" as const,
        canManage: false,
      };
      if (args.compact === "true") {
        return {
          id: row.id,
          title: row.title,
          isDefault: row.isDefault,
          accessRole: access.role,
          canManage: access.canManage,
        };
      }
      return {
        id: row.id,
        title: row.title,
        description: row.description,
        data: row.data,
        assets: row.assets,
        customInstructions: row.customInstructions ?? "",
        isDefault: row.isDefault,
        visibility: row.visibility,
        accessRole: access.role,
        canManage: access.canManage,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    });

    return { count: items.length, designSystems: items };
  },
});
