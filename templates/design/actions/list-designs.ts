import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { desc } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { accessFilter } from "@agent-native/core/sharing";

export default defineAction({
  description:
    "List all design projects accessible to the current user. " +
    "Returns title, id, project type, and timestamps.",
  schema: z.object({
    compact: z
      .enum(["true", "false"])
      .optional()
      .describe(
        "Set to 'true' for compact output (id, title, projectType only)",
      ),
  }),
  readOnly: true,
  http: { method: "GET" },
  run: async (args) => {
    const db = getDb();
    const rows = await db
      .select()
      .from(schema.designs)
      .where(accessFilter(schema.designs, schema.designShares))
      .orderBy(desc(schema.designs.updatedAt));

    if (rows.length === 0) {
      return { count: 0, designs: [] };
    }

    const items = rows.map((row) => {
      if (args.compact === "true") {
        return {
          id: row.id,
          title: row.title,
          projectType: row.projectType,
        };
      }
      return {
        id: row.id,
        title: row.title,
        description: row.description,
        projectType: row.projectType,
        designSystemId: row.designSystemId,
        visibility: row.visibility,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    });

    return { count: items.length, designs: items };
  },
});
