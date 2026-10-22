import { defineAction, fail } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { missingDesignSystemDataFields } from "../shared/design-system-validation.js";
import { assertDesignSystemAssetUrlsPersistable } from "./_inline-image-storage.js";

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
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  run: async ({ id, title, description, data, assets, customInstructions }) => {
    if (data !== undefined) {
      let parsedData: unknown;
      try {
        parsedData = JSON.parse(data);
      } catch {
        fail("data must be a valid JSON string", {
          errorCode: "invalid_design_system_data",
          statusCode: 400,
        });
      }
      const missingFields = missingDesignSystemDataFields(parsedData);
      if (missingFields.length > 0) {
        fail(
          "data is missing required design system field(s): " +
            missingFields.join(", "),
          {
            errorCode: "invalid_design_system_data",
            statusCode: 400,
          },
        );
      }
      assertDesignSystemAssetUrlsPersistable(parsedData, "data");
    }
    if (assets !== undefined) {
      let parsedAssets: unknown;
      try {
        parsedAssets = JSON.parse(assets);
      } catch {
        fail("assets must be a valid JSON string", {
          errorCode: "invalid_design_system_assets",
          statusCode: 400,
        });
      }
      assertDesignSystemAssetUrlsPersistable(parsedAssets, "assets");
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
