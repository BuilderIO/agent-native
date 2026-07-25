import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { missingDesignSystemDataFields } from "../shared/design-system-validation.js";

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
    customInstructions: z
      .string()
      .optional()
      .describe(
        "Updated free-form guidance the agent should follow when generating slides with this design system. Pass an empty string to clear.",
      ),
  }),
  run: async ({ id, title, description, data, assets, customInstructions }) => {
    // Validate that data/assets are valid JSON, and that data has the shape
    // the Design Systems page and slide renderers read unconditionally
    // (data.colors.*, data.typography.*) — see create-design-system.ts.
    if (data !== undefined) {
      let parsedData: unknown;
      try {
        parsedData = JSON.parse(data);
      } catch {
        throw new Error("data must be a valid JSON string");
      }
      const missingFields = missingDesignSystemDataFields(parsedData);
      if (missingFields.length > 0) {
        throw new Error(
          "data is missing required design system field(s): " +
            missingFields.join(", "),
        );
      }
    }
    if (assets !== undefined) {
      try {
        JSON.parse(assets);
      } catch {
        throw new Error("assets must be a valid JSON string");
      }
    }

    await assertAccess("design-system", id, "editor");

    const db = getDb();
    const now = new Date().toISOString();

    const updates: Record<string, unknown> = { updatedAt: now };
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (data !== undefined) updates.data = data;
    if (assets !== undefined) updates.assets = assets;
    if (customInstructions !== undefined)
      updates.customInstructions = customInstructions;

    await db
      .update(schema.designSystems)
      .set(updates)
      .where(eq(schema.designSystems.id, id));

    return { id, updated: true };
  },
});
