import { defineAction, fail } from "@agent-native/core/action";
import { parseDesignSystemAuthoringData } from "@agent-native/core/server/design-system-authoring";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { assertDesignSystemDsiAccess } from "../server/lib/design-system-dsi-access.js";
import { assertDesignSystemAccess } from "../server/lib/design-system-dsi-access.js";
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

    const access = await assertDesignSystemAccess(id, "editor");
    if (
      [data, assets, customInstructions, description].some(
        (value) => value !== undefined,
      ) &&
      parseDesignSystemAuthoringData(access.resource.data).workspace
    ) {
      fail(
        "Use write-design-system-artifact for authored tokens or usage guidance and update-design-system-workspace to add sources. Legacy content replacement is disabled for this authored system; title edits remain available.",
        {
          errorCode: "design_system_target_revision_required",
          statusCode: 409,
        },
      );
    }

    await assertDesignSystemDsiAccess(data);
    const db = getDb();
    const now = new Date().toISOString();

    const updates: Record<string, unknown> = { updatedAt: now };
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (data !== undefined) updates.data = data;
    if (assets !== undefined) updates.assets = assets;
    if (customInstructions !== undefined)
      updates.customInstructions = customInstructions;

    const changed = await db
      .update(schema.designSystems)
      .set(updates)
      .where(
        and(
          eq(schema.designSystems.id, id),
          eq(schema.designSystems.data, access.resource.data),
        ),
      )
      .returning({ id: schema.designSystems.id });
    if (changed.length !== 1)
      fail(
        "The design system changed during this edit. Read its latest state before retrying.",
        { errorCode: "design_system_revision_conflict", statusCode: 409 },
      );

    return { id, updated: true };
  },
});
