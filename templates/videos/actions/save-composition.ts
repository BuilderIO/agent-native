import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { assertAccess, ForbiddenError } from "@agent-native/core/sharing";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server/request-context";
import {
  hasCollabState,
  applyText,
  seedFromText,
} from "@agent-native/core/collab";
import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description:
    "Create or update a composition. Upserts by ID — creates if new, updates if existing.",
  schema: z.object({
    id: z.string().optional().describe("Composition ID"),
    title: z.string().optional().describe("Composition title"),
    type: z.string().optional().describe("Composition type"),
    data: z.string().optional().describe("Composition data as JSON string"),
  }),
  run: async (args) => {
    if (!args.id || !args.title || !args.type) {
      return { error: "Composition must have id, title, and type" };
    }

    const now = new Date().toISOString();
    const db = getDb();
    const dataStr = args.data || "{}";

    // Check if this composition already exists to decide insert vs update
    const existing = await db
      .select()
      .from(schema.compositions)
      .where(eq(schema.compositions.id, args.id))
      .limit(1);

    if (existing.length > 0) {
      // Updating — require editor access
      await assertAccess("composition", args.id, "editor");

      await db
        .update(schema.compositions)
        .set({
          title: args.title,
          type: args.type,
          data: dataStr,
          updatedAt: now,
        })
        .where(eq(schema.compositions.id, args.id));
    } else {
      // Creating — set owner/org from request context
      await db.insert(schema.compositions).values({
        id: args.id,
        title: args.title,
        type: args.type,
        data: dataStr,
        createdAt: now,
        updatedAt: now,
        ownerEmail: getRequestUserEmail() ?? "local@localhost",
        orgId: getRequestOrgId(),
      });
    }

    // Sync to collab layer for live editing
    const docId = `comp-${args.id}`;
    try {
      const collabExists = await hasCollabState(docId);
      if (collabExists) {
        await applyText(docId, dataStr, "content", "agent");
      } else {
        await seedFromText(docId, dataStr);
      }
    } catch (err) {
      // Collab sync is best-effort — SQL is the source of truth
      console.warn("[save-composition] Collab sync failed:", err);
    }

    let parsedData = {};
    try {
      parsedData = JSON.parse(dataStr);
    } catch {
      // keep empty
    }

    return {
      id: args.id,
      title: args.title,
      type: args.type,
      data: parsedData,
      createdAt: now,
      updatedAt: now,
    };
  },
});
