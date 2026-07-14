import { defineAction, embedApp } from "@agent-native/core";
import { buildDeepLink } from "@agent-native/core/server";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { assertAccess, resolveAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  redactTemplateDesignData,
  remapTemplateFileIds,
} from "../server/lib/design-template-data.js";
import { getDesignTemplatePreset } from "../shared/design-template-presets.js";
import { countLockedLayersAcrossFiles } from "../shared/locked-layers.js";
import { annotateScreenHtmlForPersist } from "../shared/screen-annotation.js";
import { sourceContentHash } from "../shared/source-workspace.js";

interface TemplateFile {
  id: string;
  filename: string;
  fileType: string;
  content: string;
}

export default defineAction({
  description:
    "Create an editable design from a reusable template. The action copies the template files, exact dimensions, defaults, and locked layers. " +
    "When a prompt is supplied, refine the copied files with get-design-snapshot and edit-design; do not replace the template with generate-design.",
  schema: z.object({
    templateId: z.string().min(1).describe("Template or starter template ID"),
    title: z.string().trim().min(1).max(120).optional(),
    prompt: z
      .string()
      .trim()
      .max(4_000)
      .optional()
      .describe("Optional refinement request to apply after copying"),
    designSystemId: z
      .string()
      .min(1)
      .nullable()
      .optional()
      .describe("Override the template design system, or null to unlink"),
  }),
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Design from template",
      description: "Open the copied template in the Design editor.",
      iframeTitle: "Agent-Native Design",
      openLabel: "Open design",
      height: 680,
    }),
  },
  run: async ({ templateId, title, prompt, designSystemId }) => {
    const preset = getDesignTemplatePreset(templateId);
    const db = getDb();

    let templateTitle: string;
    let templateDescription: string | null;
    let templateCategory: string;
    let templateData: string;
    let templateDesignSystemId: string | null;
    let templateUpdatedAt: string | null;
    let files: TemplateFile[];

    if (preset) {
      const presetFileId = `file:${preset.id}`;
      templateTitle = preset.title;
      templateDescription = preset.description;
      templateCategory = preset.category;
      templateDesignSystemId = null;
      templateUpdatedAt = null;
      templateData = JSON.stringify({
        canvasFrames: {
          [presetFileId]: {
            x: 0,
            y: 0,
            width: preset.width,
            height: preset.height,
          },
        },
      });
      files = [
        {
          id: presetFileId,
          filename: preset.filename,
          fileType: "html",
          content: preset.content,
        },
      ];
    } else {
      const access = await resolveAccess("design-template", templateId);
      if (!access) throw new Error("Template not found");
      const template = access.resource;
      templateTitle = String(template.title ?? "Untitled template");
      templateDescription =
        typeof template.description === "string" ? template.description : null;
      templateCategory = String(template.category ?? "other");
      templateData = typeof template.data === "string" ? template.data : "{}";
      templateDesignSystemId =
        typeof template.designSystemId === "string"
          ? template.designSystemId
          : null;
      templateUpdatedAt =
        typeof template.updatedAt === "string" ? template.updatedAt : null;
      files = await db
        .select({
          id: schema.designTemplateFiles.id,
          filename: schema.designTemplateFiles.filename,
          fileType: schema.designTemplateFiles.fileType,
          content: schema.designTemplateFiles.content,
        })
        .from(schema.designTemplateFiles)
        .where(eq(schema.designTemplateFiles.templateId, templateId));
    }

    if (files.length === 0) throw new Error("Template has no files");

    let linkedDesignSystemId =
      designSystemId === undefined ? templateDesignSystemId : designSystemId;
    if (linkedDesignSystemId) {
      try {
        await assertAccess("design-system", linkedDesignSystemId, "viewer");
      } catch {
        if (designSystemId !== undefined)
          throw new Error("Design system not found");
        linkedDesignSystemId = null;
      }
    }

    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("Not authenticated");
    const orgId = getRequestOrgId() ?? null;
    const designId = nanoid();
    const now = new Date().toISOString();
    const fileIdMap = new Map(files.map((file) => [file.id, nanoid()]));
    const data = remapTemplateFileIds(
      redactTemplateDesignData(templateData),
      fileIdMap,
    );
    data.templateSource = {
      templateId,
      title: templateTitle,
      category: templateCategory,
      templateUpdatedAt,
      instantiatedAt: now,
    };
    if (prompt) data.templatePrompt = prompt;

    const persistedFiles = files.map((file) => ({
      ...file,
      id: fileIdMap.get(file.id)!,
      content: annotateScreenHtmlForPersist(file.content, file.fileType),
    }));

    await db.transaction(async (tx) => {
      await tx.insert(schema.designs).values({
        id: designId,
        title: title ?? templateTitle,
        description: templateDescription,
        data: JSON.stringify(data),
        projectType: "prototype",
        designSystemId: linkedDesignSystemId,
        ownerEmail,
        orgId,
        visibility: orgId ? "org" : "private",
        createdAt: now,
        updatedAt: now,
      });
      await tx.insert(schema.designFiles).values(
        persistedFiles.map((file) => ({
          id: file.id,
          designId,
          filename: file.filename,
          fileType: file.fileType,
          content: file.content,
          createdAt: now,
          updatedAt: now,
        })),
      );
    });

    return {
      id: designId,
      title: title ?? templateTitle,
      templateId,
      templateTitle,
      fileCount: files.length,
      lockedLayerCount: countLockedLayersAcrossFiles(persistedFiles),
      templateBaselineFiles: persistedFiles.map((file) => ({
        id: file.id,
        contentHash: sourceContentHash(file.content),
      })),
      promptPending: Boolean(prompt),
      nextRequiredAction: prompt
        ? "Call get-design-snapshot, then refine unlocked content with edit-design. Do not call generate-design."
        : null,
    };
  },
  link: ({ result }) => {
    if (!result || typeof result !== "object") return null;
    const id = (result as { id?: string }).id;
    if (!id) return null;
    return {
      url: buildDeepLink({
        app: "design",
        view: "editor",
        params: { designId: id },
        to: `/design/${encodeURIComponent(id)}`,
      }),
      label: "Open design",
      view: "editor",
    };
  },
});
