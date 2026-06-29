import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

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
    designSystemId: z
      .string()
      .min(1)
      .nullable()
      .optional()
      .describe("Design system ID to link, or null to unlink"),
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
    if (designSystemId != null) {
      await assertAccess("design-system", designSystemId, "viewer");
    }

    const db = getDb();
    const now = new Date().toISOString();

    const updates: Record<string, unknown> = { updatedAt: now };
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (data !== undefined) {
      // Merge into the existing data blob instead of replacing it wholesale, so
      // a partial update (e.g. just `tweaks`) doesn't destroy framework-owned
      // keys like `canvasFrames`. Mirrors generate-design's read-merge.
      const [existing] = await db
        .select({ data: schema.designs.data })
        .from(schema.designs)
        .where(eq(schema.designs.id, id));
      const asRecord = (raw: string | null | undefined) => {
        if (!raw) return {} as Record<string, unknown>;
        try {
          const parsed = JSON.parse(raw);
          return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : ({} as Record<string, unknown>);
        } catch {
          return {} as Record<string, unknown>;
        }
      };
      const incomingParsed = JSON.parse(data);
      if (
        incomingParsed &&
        typeof incomingParsed === "object" &&
        !Array.isArray(incomingParsed)
      ) {
        updates.data = JSON.stringify({
          ...asRecord(existing?.data),
          ...(incomingParsed as Record<string, unknown>),
        });
      } else {
        // Non-object JSON (array/primitive): keep the original verbatim write.
        updates.data = data;
      }
    }
    if (projectType !== undefined) updates.projectType = projectType;
    if (designSystemId !== undefined) updates.designSystemId = designSystemId;

    await db
      .update(schema.designs)
      .set(updates)
      .where(eq(schema.designs.id, id));

    return { id, updated: true };
  },
});
