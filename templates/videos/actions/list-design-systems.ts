import { defineAction } from "@agent-native/core";
import { accessFilter } from "@agent-native/core/sharing";
import { desc } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

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
    // Project only the columns the list needs. A bare `.select()` also pulls
    // the heavy `assets` JSON blob and `custom_instructions`, which no list
    // consumer reads — those are fetched on demand via `get-design-system`.
    const rows = await db
      .select({
        id: schema.designSystems.id,
        title: schema.designSystems.title,
        description: schema.designSystems.description,
        data: schema.designSystems.data,
        isDefault: schema.designSystems.isDefault,
        visibility: schema.designSystems.visibility,
        createdAt: schema.designSystems.createdAt,
        updatedAt: schema.designSystems.updatedAt,
      })
      .from(schema.designSystems)
      .where(accessFilter(schema.designSystems, schema.designSystemShares))
      .orderBy(desc(schema.designSystems.updatedAt));

    if (rows.length === 0) {
      return { count: 0, designSystems: [] };
    }

    const items = rows.map((row) => {
      if (args.compact === "true") {
        return {
          id: row.id,
          title: row.title,
          isDefault: row.isDefault,
        };
      }
      return {
        id: row.id,
        title: row.title,
        description: row.description,
        data: row.data,
        isDefault: row.isDefault,
        visibility: row.visibility,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    });

    return { count: items.length, designSystems: items };
  },
});
