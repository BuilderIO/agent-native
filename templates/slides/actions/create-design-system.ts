import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server/request-context";
import { accessFilter } from "@agent-native/core/sharing";

export default defineAction({
  description:
    "Create a new design system with brand colors, typography, spacing, and other design tokens. " +
    "If this is the first design system for the user, it is automatically set as the default.",
  schema: z.object({
    title: z.string().describe("Design system name (e.g. 'Acme Corp Brand')"),
    description: z
      .string()
      .optional()
      .describe("Short description of the design system"),
    data: z
      .string()
      .describe(
        "JSON string of DesignSystemData (colors, typography, spacing, etc.)",
      ),
    assets: z
      .string()
      .optional()
      .describe("JSON string of DesignSystemAsset[] (logos, fonts, images)"),
  }),
  run: async ({ title, description, data, assets }) => {
    const db = getDb();
    const id = nanoid();
    const now = new Date().toISOString();
    const ownerEmail = getRequestUserEmail() ?? "local@localhost";
    const orgId = getRequestOrgId();

    // Check if user has any existing design systems to determine default
    const existing = await db
      .select({ id: schema.designSystems.id })
      .from(schema.designSystems)
      .where(accessFilter(schema.designSystems, schema.designSystemShares))
      .limit(1);

    const isDefault = existing.length === 0;

    await db.insert(schema.designSystems).values({
      id,
      title,
      description: description ?? null,
      data,
      assets: assets ?? null,
      isDefault,
      ownerEmail,
      orgId,
      createdAt: now,
      updatedAt: now,
    });

    return { id, title, isDefault };
  },
});
