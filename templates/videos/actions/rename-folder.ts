import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { assertAccess } from "@agent-native/core/sharing";
import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description: "Rename an existing library folder.",
  schema: z.object({
    id: z.string().describe("Folder id"),
    name: z.string().describe("New folder name"),
  }),
  run: async ({ id, name }) => {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new Error("Folder name cannot be empty");
    }

    await assertAccess("folder", id, "editor");

    const db = getDb();
    const now = new Date().toISOString();

    const result = await db
      .update(schema.folders)
      .set({ name: trimmed, updatedAt: now })
      .where(eq(schema.folders.id, id))
      .returning();

    if (result.length === 0) {
      throw new Error("Folder not found");
    }

    return {
      id: result[0].id,
      name: result[0].name,
      updatedAt: result[0].updatedAt,
    };
  },
});
