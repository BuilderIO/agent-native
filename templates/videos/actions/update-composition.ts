import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { assertAccess } from "@agent-native/core/sharing";
import {
  hasCollabState,
  applyText,
  seedFromText,
} from "@agent-native/core/collab";
import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description: "Update an existing composition by ID",
  schema: z.object({
    id: z.string().optional().describe("Composition ID"),
    title: z.string().optional().describe("New title (optional)"),
    type: z.string().optional().describe("New type (optional)"),
    data: z
      .string()
      .optional()
      .describe("New composition data as JSON string (optional)"),
  }),
  run: async (args) => {
    if (!args.id) {
      return { error: "Composition id is required" };
    }

    await assertAccess("composition", args.id, "editor");

    const db = getDb();
    const now = new Date().toISOString();

    const updates: Record<string, any> = { updatedAt: now };
    if (args.title !== undefined) updates.title = args.title;
    if (args.type !== undefined) updates.type = args.type;
    if (args.data !== undefined) updates.data = args.data;

    // Update SQL (source of truth)
    const result = await db
      .update(schema.compositions)
      .set(updates)
      .where(eq(schema.compositions.id, args.id))
      .returning();

    // Sync data to collab layer for live editing
    if (args.data !== undefined) {
      const docId = `comp-${args.id}`;
      const dataStr =
        typeof args.data === "string" ? args.data : JSON.stringify(args.data);
      try {
        const exists = await hasCollabState(docId);
        if (exists) {
          await applyText(docId, dataStr, "content", "agent");
        } else {
          await seedFromText(docId, dataStr);
        }
      } catch (err) {
        // Collab sync is best-effort — SQL is the source of truth
        console.warn("[update-composition] Collab sync failed:", err);
      }
    }

    if (result.length > 0) {
      const row = result[0];
      return {
        id: row.id,
        title: row.title,
        type: row.type,
        data: JSON.parse(row.data),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        ownerEmail: row.ownerEmail,
        orgId: row.orgId,
        visibility: row.visibility,
      };
    }

    return { error: "Composition not found" };
  },
});
