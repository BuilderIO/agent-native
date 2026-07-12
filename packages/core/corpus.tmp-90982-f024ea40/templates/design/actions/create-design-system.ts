import { defineAction } from "@agent-native/core";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server/request-context";
import { and, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  DESIGN_SYSTEM_TEMPLATE_IDS,
  getProductionDesignSystemTemplate,
} from "../shared/design-system-templates.js";

export const createDesignSystemSchema = z
  .object({
    templateId: z
      .enum(DESIGN_SYSTEM_TEMPLATE_IDS)
      .optional()
      .describe(
        "Optional production design-system template to copy: material-3, carbon-white, or primer-light",
      ),
    title: z
      .string()
      .trim()
      .min(1, "title is required")
      .optional()
      .describe(
        "Design system name (required without templateId; optional title override for a template)",
      ),
    description: z
      .string()
      .optional()
      .describe("Short description of the design system"),
    data: z
      .string()
      .trim()
      .min(1, "data is required")
      .optional()
      .describe(
        "JSON string of DesignSystemData (required without templateId; templates supply their verified token snapshot)",
      ),
    assets: z
      .string()
      .optional()
      .describe("JSON string of DesignSystemAsset[] (logos, fonts, images)"),
    customInstructions: z
      .string()
      .optional()
      .describe(
        "Free-form guidance the agent should follow whenever it generates designs using this design system (tone, voice, layout preferences, dos and don'ts). For templates, this is appended to the system's built-in guidance.",
      ),
  })
  .superRefine((value, ctx) => {
    if (!value.templateId && !value.title) {
      ctx.addIssue({
        code: "custom",
        path: ["title"],
        message: "title is required without templateId",
      });
    }
    if (!value.templateId && !value.data) {
      ctx.addIssue({
        code: "custom",
        path: ["data"],
        message: "data is required without templateId",
      });
    }
    if (value.templateId && value.data) {
      ctx.addIssue({
        code: "custom",
        path: ["data"],
        message: "data cannot override a production template snapshot",
      });
    }
  });

export default defineAction({
  description:
    "Create a design system from custom tokens or copy a source-linked production template (Material Design 3, Carbon, or Primer). " +
    "If this is the first design system for the user, it is automatically set as the default.",
  schema: createDesignSystemSchema,
  run: async ({
    templateId,
    title,
    description,
    data,
    assets,
    customInstructions,
  }) => {
    const template = templateId
      ? getProductionDesignSystemTemplate(templateId)
      : undefined;
    const resolvedTitle = title ?? template?.title;
    const resolvedDescription = description ?? template?.description;
    const resolvedData =
      data ?? (template ? JSON.stringify(template.data) : "");
    const resolvedInstructions = template
      ? [
          template.customInstructions,
          customInstructions?.trim()
            ? `Additional guidance:\n${customInstructions.trim()}`
            : "",
        ]
          .filter(Boolean)
          .join("\n\n")
      : (customInstructions ?? "");

    if (!resolvedTitle || !resolvedData) {
      throw new Error("title and data are required");
    }

    // Validate that data is valid JSON and not an empty primitive.
    try {
      const parsed = JSON.parse(resolvedData);
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

    // Check only this user's owned systems within the same org. Shared systems
    // should not prevent the first system a user creates from becoming their
    // default, and systems in other orgs must not suppress the default in this org.
    const existing = await db
      .select({ id: schema.designSystems.id })
      .from(schema.designSystems)
      .where(
        orgId
          ? and(
              eq(schema.designSystems.ownerEmail, ownerEmail),
              eq(schema.designSystems.orgId, orgId),
            )
          : and(
              eq(schema.designSystems.ownerEmail, ownerEmail),
              isNull(schema.designSystems.orgId),
            ),
      )
      .limit(1);

    const isDefault = existing.length === 0;

    await db.insert(schema.designSystems).values({
      id,
      title: resolvedTitle,
      description: resolvedDescription ?? null,
      data: resolvedData,
      assets: assets ?? null,
      customInstructions: resolvedInstructions,
      isDefault,
      ownerEmail,
      orgId,
      createdAt: now,
      updatedAt: now,
    });

    return {
      id,
      title: resolvedTitle,
      isDefault,
      templateId: template?.id,
      sourceUrl: template?.sourceUrl,
      version: template?.version,
    };
  },
});
