import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { assertAccess } from "@agent-native/core/sharing";

export default defineAction({
  description:
    "Update an existing design project. Requires editor access. " +
    "Only provided fields are updated; omitted fields are left unchanged.",
  schema: z.object({
    id: z.string().describe("Design ID"),
    title: z.string().optional().describe("New title"),
    description: z.string().optional().describe("New description"),
    data: z.string().optional().describe("Updated JSON string of design data"),
    projectType: z
      .enum(["prototype", "other"])
      .optional()
      .describe("Updated project type"),
    designSystemId: z.string().optional().describe("Design system ID to link"),
  }),
  run: async ({
    id,
    title,
    description,
    data,
    projectType,
    designSystemId,
  }) => {
    if (data !== undefined) {
      try {
        JSON.parse(data);
      } catch {
        throw new Error("data must be a valid JSON string");
      }
    }

    await assertAccess("design", id, "editor");

    const db = getDb();
    const now = new Date().toISOString();

    const updates: Record<string, unknown> = { updatedAt: now };
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (data !== undefined) updates.data = data;
    if (projectType !== undefined) updates.projectType = projectType;
    if (designSystemId !== undefined) updates.designSystemId = designSystemId;

    await db
      .update(schema.designs)
      .set(updates)
      .where(eq(schema.designs.id, id));

    return { id, updated: true };
  },
});
