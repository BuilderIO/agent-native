import { defineAction } from "@agent-native/core";
import { resolveAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  parseDesignTemplateData,
  readDesignTemplateSource,
  templateFileDimensions,
} from "../server/lib/design-template-data.js";
import { getDesignTemplatePreset } from "../shared/design-template-presets.js";
import { lockedLayerSnapshots } from "../shared/locked-layers.js";

interface OriginalTemplateFile {
  templateFileId: string;
  filename: string;
  fileType: string;
  content: string;
  width: number | null;
  height: number | null;
}

export default defineAction({
  description:
    "Read the ORIGINAL, unmodified template a design was created from. " +
    "Copied template screens are edited in place, so the design's own files stop showing what the template looked like as soon as the first refinement lands. " +
    "Call this on any follow-up request against a template-created design to recover the template's exact canvas dimensions, typography, and markup before editing. " +
    "Pass designId to resolve the template behind an open design, or templateId to read a template directly. Read-only.",
  schema: z
    .object({
      designId: z
        .string()
        .optional()
        .describe("Design created from a template; resolves its template"),
      templateId: z
        .string()
        .optional()
        .describe("Template to read directly when the design id is unknown"),
    })
    .refine((input) => input.designId || input.templateId, {
      message: "Pass designId or templateId",
    }),
  readOnly: true,
  http: { method: "GET" },
  run: async ({ designId, templateId }) => {
    let resolvedTemplateId = templateId;
    let designFileIdByTemplateFileId = new Map<string, string>();
    let instantiatedAt: string | null = null;

    if (designId) {
      const designAccess = await resolveAccess("design", designId);
      if (!designAccess) throw new Error("Design not found");
      const design =
        designAccess.resource as typeof schema.designs.$inferSelect;
      const source = readDesignTemplateSource(
        parseDesignTemplateData(design.data),
      );
      if (!source) {
        return {
          designId,
          fromTemplate: false as const,
          message:
            "This design was not created from a template; there is no original template to compare against.",
        };
      }
      if (templateId && templateId !== source.templateId) {
        throw new Error(
          `Design ${designId} was created from template "${source.templateId}", not "${templateId}"`,
        );
      }
      resolvedTemplateId = source.templateId;
      instantiatedAt = source.instantiatedAt;
      designFileIdByTemplateFileId = new Map(
        source.files.map(
          (file) => [file.templateFileId, file.designFileId] as const,
        ),
      );
    }

    if (!resolvedTemplateId) throw new Error("Pass designId or templateId");

    const preset = getDesignTemplatePreset(resolvedTemplateId);
    let title: string;
    let category: string;
    let description: string | null;
    let templateDesignSystemId: string | null;
    let files: OriginalTemplateFile[];

    if (preset) {
      title = preset.title;
      category = preset.category;
      description = preset.description;
      templateDesignSystemId = null;
      files = [
        {
          templateFileId: `file:${preset.id}`,
          filename: preset.filename,
          fileType: "html",
          content: preset.content,
          width: preset.width,
          height: preset.height,
        },
      ];
    } else {
      const access = await resolveAccess("design-template", resolvedTemplateId);
      if (!access) throw new Error("Template not found");
      const template = access.resource;
      title = String(template.title ?? "Untitled template");
      category = String(template.category ?? "other");
      description =
        typeof template.description === "string" ? template.description : null;
      templateDesignSystemId =
        typeof template.designSystemId === "string"
          ? template.designSystemId
          : null;

      const templateData = parseDesignTemplateData(
        typeof template.data === "string" ? template.data : "{}",
      );
      const fallbackWidth =
        typeof template.width === "number" ? template.width : null;
      const fallbackHeight =
        typeof template.height === "number" ? template.height : null;

      const rows = await getDb()
        .select({
          id: schema.designTemplateFiles.id,
          filename: schema.designTemplateFiles.filename,
          fileType: schema.designTemplateFiles.fileType,
          content: schema.designTemplateFiles.content,
        })
        .from(schema.designTemplateFiles)
        .where(eq(schema.designTemplateFiles.templateId, resolvedTemplateId));

      files = rows.map((row) => {
        const frame = templateFileDimensions(templateData, row.id);
        return {
          templateFileId: row.id,
          filename: row.filename,
          fileType: row.fileType,
          content: row.content,
          width: frame.width ?? fallbackWidth,
          height: frame.height ?? fallbackHeight,
        };
      });
    }

    return {
      templateId: resolvedTemplateId,
      title,
      description,
      category,
      designSystemId: templateDesignSystemId,
      isBuiltIn: Boolean(preset),
      ...(designId
        ? { designId, fromTemplate: true as const, instantiatedAt }
        : {}),
      files: files.map((file) => ({
        ...file,
        designFileId:
          designFileIdByTemplateFileId.get(file.templateFileId) ?? null,
        lockedLayers: lockedLayerSnapshots(file.content).map((layer) => ({
          nodeId: layer.id,
          layerName: layer.label,
        })),
      })),
      fileCount: files.length,
      nextRequiredAction:
        "Treat these dimensions, fonts, and locked layers as authoritative. Apply the user's request with edit-design on the design's own files; do not resize the artboard or call generate-design.",
    };
  },
});
