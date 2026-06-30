import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  parseBoardObjects,
  type BoardObjectEntry,
  type CanvasPrimitiveKindLike,
} from "../shared/board-objects.js";

const geometrySchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  rotation: z.number().optional(),
  z: z.number().optional(),
});

export default defineAction({
  description:
    "Create a new board object (canvas primitive) on the design canvas. " +
    "Board objects float on the infinite surface and are not bound to any screen iframe. " +
    "Requires editor access on the design. " +
    "Returns the new object id.",
  schema: z.object({
    designId: z.string().describe("Design ID to add the board object to."),
    kind: z
      .enum([
        "frame",
        "rectangle",
        "ellipse",
        "polygon",
        "star",
        "line",
        "arrow",
        "text",
        "path",
      ] satisfies CanvasPrimitiveKindLike[])
      .describe("Primitive kind."),
    geometry: geometrySchema.describe(
      "Position and dimensions on the canvas surface.",
    ),
    fill: z.string().optional().describe("CSS fill color or value."),
    stroke: z.string().optional().describe("CSS stroke color."),
    strokeWidth: z.number().optional().describe("Stroke width in pixels."),
    text: z
      .string()
      .optional()
      .describe("Text content (for text and frame kinds)."),
    pathData: z
      .string()
      .optional()
      .describe("SVG path data string (for path kind)."),
    points: z
      .array(z.object({ x: z.number(), y: z.number() }))
      .optional()
      .describe("Control points (for polygon / star / line / arrow kinds)."),
    autoSize: z
      .boolean()
      .optional()
      .describe(
        "Whether the object should auto-size to its text content (text kind).",
      ),
    name: z.string().optional().describe("Human-readable display name."),
  }),
  run: async ({
    designId,
    kind,
    geometry,
    fill,
    stroke,
    strokeWidth,
    text,
    pathData,
    points,
    autoSize,
    name,
  }) => {
    await assertAccess("design", designId, "editor");

    const db = getDb();
    const id = nanoid();
    const now = new Date().toISOString();

    const entry: BoardObjectEntry = {
      id,
      kind,
      geometry,
      ...(fill !== undefined && { fill }),
      ...(stroke !== undefined && { stroke }),
      ...(strokeWidth !== undefined && { strokeWidth }),
      ...(text !== undefined && { text }),
      ...(pathData !== undefined && { pathData }),
      ...(points !== undefined && { points }),
      ...(autoSize !== undefined && { autoSize }),
      ...(name !== undefined && { name }),
      createdAt: now,
    };

    // Transactional read-merge-write of designs.data.boardObjects so concurrent
    // creates cannot clobber each other or lose framework-owned data keys.
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
      boardObjects[id] = entry;

      await tx
        .update(schema.designs)
        .set({
          data: JSON.stringify({ ...parsed, boardObjects }),
          updatedAt: now,
        })
        .where(eq(schema.designs.id, designId));
    });

    return { id, designId, created: true };
  },
});
