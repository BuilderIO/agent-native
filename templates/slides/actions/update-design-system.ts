import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { assertAccess } from "@agent-native/core/sharing";

export default defineAction({
  description:
    "Update an existing design system. Requires editor access. " +
    "Only provided fields are updated; omitted fields are left unchanged.",
  schema: z.object({
    id: z.string().describe("Design system ID"),
    title: z.string().optional().describe("New title"),
    description: z.string().optional().describe("New description"),
    data: z
      .string()
      .optional()
      .describe("Updated JSON string of DesignSystemData"),
    assets: z
      .string()
      .optional()
      .describe("Updated JSON string of DesignSystemAsset[]"),
  }),
  run: async ({ id, title, description, data, assets }) => {
    await assertAccess("design-system", id, "editor");

    const db = getDb();
    const now = new Date().toISOString();

    const updates: Record<string, unknown> = { updatedAt: now };
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (data !== undefined) updates.data = data;
    if (assets !== undefined) updates.assets = assets;

    await db
      .update(schema.designSystems)
      .set(updates)
      .where(eq(schema.designSystems.id, id));

    return { id, updated: true };
  },
});
