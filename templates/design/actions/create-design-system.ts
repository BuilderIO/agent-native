import { defineAction } from "@agent-native/core";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server/request-context";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description:
    "Create a new design system with brand colors, typography, spacing, and other design tokens. " +
    "If this is the first design system for the user, it is automatically set as the default.",
  schema: z.object({
    title: z
      .string()
      .trim()
      .min(1, "title is required")
      .describe("Design system name (e.g. 'Acme Corp Brand')"),
    description: z
      .string()
      .optional()
      .describe("Short description of the design system"),
    data: z
      .string()
      .trim()
      .min(1, "data is required")
      .describe(
        "JSON string of DesignSystemData (colors, typography, spacing, etc.)",
      ),
    assets: z
      .string()
      .optional()
      .describe("JSON string of DesignSystemAsset[] (logos, fonts, images)"),
    customInstructions: z
      .string()
      .optional()
      .describe(
        "Free-form guidance the agent should follow whenever it generates designs using this design system (tone, voice, layout preferences, dos and don'ts).",
      ),
  }),
  run: async ({ title, description, data, assets, customInstructions }) => {
    // Validate that data is valid JSON and not an empty primitive.
    try {
      const parsed = JSON.parse(data);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error();
      }
    } catch {
      throw new Error("data must be a valid JSON object string");
    }
    if (assets) {
      try {
        JSON.parse(assets);
      } catch {
        throw new Error("assets must be a valid JSON string");
      }
    }

    const db = getDb();
    const id = nanoid();
    const now = new Date().toISOString();
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");
    const orgId = getRequestOrgId();

    // Check only this user's owned systems. Shared systems should not prevent
    // the first system a user creates from becoming their default.
    const existing = await db
      .select({ id: schema.designSystems.id })
      .from(schema.designSystems)
      .where(eq(schema.designSystems.ownerEmail, ownerEmail))
      .limit(1);

    const isDefault = existing.length === 0;

    await db.insert(schema.designSystems).values({
      id,
      title,
      description: description ?? null,
      data,
      assets: assets ?? null,
      customInstructions: customInstructions ?? "",
      isDefault,
      ownerEmail,
      orgId,
      createdAt: now,
      updatedAt: now,
    });

    return { id, title, isDefault };
  },
});
