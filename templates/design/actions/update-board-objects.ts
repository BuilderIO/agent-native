import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { parseBoardObjects } from "../shared/board-objects.js";

const geometryUpdateSchema = z.object({
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  rotation: z.number().optional(),
  z: z.number().optional(),
});

export default defineAction({
  description:
    "Update or delete one or more existing board objects on the design canvas. " +
    "Pass updates (partial geometry/style/text changes) and/or deletes (ids to remove). " +
    "Requires editor access on the design.",
  schema: z.object({
    designId: z.string().describe("Design ID."),
    updates: z
      .array(
        z.object({
          id: z.string().describe("Board object id to update."),
          geometry: geometryUpdateSchema
            .optional()
            .describe("Partial geometry patch."),
          fill: z.string().optional().describe("New fill color."),
          stroke: z.string().optional().describe("New stroke color."),
          strokeWidth: z.number().optional().describe("New stroke width."),
          text: z.string().optional().describe("New text content."),
          name: z.string().optional().describe("New display name."),
        }),
      )
      .default([])
      .describe("Objects to update (empty = updates-only delete operation)."),
    deletes: z
      .array(z.string())
      .optional()
      .describe("Board object ids to remove."),
  }),
  run: async ({ designId, updates, deletes }) => {
    await assertAccess("design", designId, "editor");

    const db = getDb();
    const now = new Date().toISOString();

    const updatedIds: string[] = [];
    const deletedIds: string[] = [];

    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ data: schema.designs.data })
        .from(schema.designs)
        .where(eq(schema.designs.id, designId));

      if (!existing) {
        throw new Error(`Design "${designId}" not found.`);
      }

      let parsed: Record<string, unknown>;
      try {
        const raw = JSON.parse(existing.data);
        parsed =
          raw && typeof raw === "object" && !Array.isArray(raw)
            ? (raw as Record<string, unknown>)
            : {};
      } catch {
        parsed = {};
      }

      const boardObjects = parseBoardObjects(parsed["boardObjects"]);

      for (const update of updates) {
        const obj = boardObjects[update.id];
        if (!obj) continue; // Skip unknown ids silently — idempotent.

        if (update.geometry) {
          obj.geometry = { ...obj.geometry, ...update.geometry };
        }
        if (update.fill !== undefined) obj.fill = update.fill;
        if (update.stroke !== undefined) obj.stroke = update.stroke;
        if (update.strokeWidth !== undefined)
          obj.strokeWidth = update.strokeWidth;
        if (update.text !== undefined) obj.text = update.text;
        if (update.name !== undefined) obj.name = update.name;

        boardObjects[update.id] = obj;
        updatedIds.push(update.id);
      }

      for (const id of deletes ?? []) {
        if (id in boardObjects) {
          // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
          delete boardObjects[id];
          deletedIds.push(id);
        }
      }

      await tx
        .update(schema.designs)
        .set({
          data: JSON.stringify({ ...parsed, boardObjects }),
          updatedAt: now,
        })
        .where(eq(schema.designs.id, designId));
    });

    return { designId, updatedIds, deletedIds };
  },
});
