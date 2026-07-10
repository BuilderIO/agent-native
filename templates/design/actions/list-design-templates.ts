import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { accessFilter } from "@agent-native/core/sharing";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { DESIGN_TEMPLATE_PRESETS } from "../shared/design-template-presets.js";
import { designTemplateCategorySchema } from "./save-design-as-template.js";

const PREVIEW_MAX_BYTES = 50_000;

export default defineAction({
  description:
    "List reusable Design templates, including built-in starters plus templates the user can access or publicly discover.",
  schema: z.object({
    category: designTemplateCategorySchema.optional(),
    includePreview: z.enum(["true", "false"]).optional().default("false"),
  }),
  readOnly: true,
  http: { method: "GET" },
  run: async ({ category, includePreview }) => {
    const db = getDb();
    const userEmail = getRequestUserEmail();
    const access = accessFilter(
      schema.designTemplates,
      schema.designTemplateShares,
      { userEmail, orgId: getRequestOrgId() },
      "viewer",
      { includePublic: true },
    );
    const rows = await db
      .select({
        id: schema.designTemplates.id,
        title: schema.designTemplates.title,
        description: schema.designTemplates.description,
        category: schema.designTemplates.category,
        width: schema.designTemplates.width,
        height: schema.designTemplates.height,
        lockedLayerCount: schema.designTemplates.lockedLayerCount,
        visibility: schema.designTemplates.visibility,
        ownerEmail: schema.designTemplates.ownerEmail,
        createdAt: schema.designTemplates.createdAt,
        updatedAt: schema.designTemplates.updatedAt,
      })
      .from(schema.designTemplates)
      .where(
        category
          ? and(access, eq(schema.designTemplates.category, category))
          : access,
      )
      .orderBy(desc(schema.designTemplates.updatedAt));

    const previews = new Map<string, string>();
    if (includePreview === "true" && rows.length > 0) {
      const files = await db
        .select({
          templateId: schema.designTemplateFiles.templateId,
          filename: schema.designTemplateFiles.filename,
          fileType: schema.designTemplateFiles.fileType,
          content: sql<string>`substr(${schema.designTemplateFiles.content}, 1, ${PREVIEW_MAX_BYTES})`,
        })
        .from(schema.designTemplateFiles)
        .where(
          inArray(
            schema.designTemplateFiles.templateId,
            rows.map((row) => row.id),
          ),
        );
      for (const file of files) {
        if (!previews.has(file.templateId) && file.fileType === "html") {
          previews.set(file.templateId, file.content);
        }
        if (file.filename === "index.html" && file.fileType === "html") {
          previews.set(file.templateId, file.content);
        }
      }
    }

    const presets = DESIGN_TEMPLATE_PRESETS.filter(
      (preset) => !category || preset.category === category,
    ).map((preset) => ({
      id: preset.id,
      title: preset.title,
      description: preset.description,
      category: preset.category,
      width: preset.width,
      height: preset.height,
      lockedLayerCount: 2,
      visibility: "public" as const,
      isOwner: false,
      source: "starter" as const,
      createdAt: null,
      updatedAt: null,
      ...(includePreview === "true" ? { previewHtml: preset.content } : {}),
    }));

    const saved = rows.map(({ ownerEmail, ...row }) => ({
      ...row,
      isOwner:
        !!userEmail && ownerEmail.toLowerCase() === userEmail.toLowerCase(),
      source: "saved" as const,
      ...(includePreview === "true"
        ? { previewHtml: previews.get(row.id) ?? null }
        : {}),
    }));

    return {
      count: presets.length + saved.length,
      starterCount: presets.length,
      savedCount: saved.length,
      templates: [...presets, ...saved],
    };
  },
});
