import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import {
  assertAccess,
  resolveAccess,
  ForbiddenError,
} from "@agent-native/core/sharing";
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

    // Resolve the caller's access to this composition id (if any). This is
    // scoped — it returns null when the row doesn't exist OR when it exists
    // but the caller has no access. Treating "no access" the same as
    // "doesn't exist" prevents cross-tenant existence probing AND prevents
    // a malicious caller from forcing a write path against someone else's
    // composition by passing their id.
    const access = await resolveAccess("composition", args.id);

    if (access) {
      // Updating — require editor access (assertAccess re-checks role)
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
      const ownerEmail = getRequestUserEmail();
      if (!ownerEmail) throw new Error("no authenticated user");
      try {
        await db.insert(schema.compositions).values({
          id: args.id,
          title: args.title,
          type: args.type,
          data: dataStr,
          createdAt: now,
          updatedAt: now,
          ownerEmail,
          orgId: getRequestOrgId(),
        });
      } catch (err) {
        // PK conflict means the id is taken by another tenant we couldn't
        // see via resolveAccess. Reject rather than overwrite their row.
        throw new ForbiddenError(
          `Composition ${args.id} already exists and is not accessible to you`,
        );
      }
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
