import { defineAction } from "@agent-native/core";
import { buildDeepLink } from "@agent-native/core/server";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { resolveAccess } from "@agent-native/core/sharing";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { buildDesignSnapshot } from "../server/lib/design-snapshot.js";
import {
  firstTemplateDimensions,
  redactTemplateDesignData,
  remapTemplateFileIds,
} from "../server/lib/design-template-data.js";
import { countLockedLayersAcrossFiles } from "../shared/locked-layers.js";

export const designTemplateCategorySchema = z.enum([
  "ad",
  "one-pager",
  "landing-page",
  "social",
  "presentation",
  "other",
]);

export default defineAction({
  description:
    "Save the current live snapshot of a design as a reusable template. " +
    "Dimensions, files, canvas defaults, and data-agent-native-locked layers are preserved.",
  schema: z.object({
    designId: z.string().min(1).describe("Source design ID"),
    title: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(500).optional(),
    category: designTemplateCategorySchema.optional().default("other"),
  }),
  run: async ({ designId, title, description, category }) => {
    const access = await resolveAccess("design", designId);
    if (!access || !["owner", "admin", "editor"].includes(access.role)) {
      throw new Error("Design not found or not editable");
    }

    const source = access.resource;
    const rawData = typeof source.data === "string" ? source.data : "{}";
    const parsedSourceData = (() => {
      try {
        return JSON.parse(rawData) as Record<string, unknown>;
      } catch {
        return {};
      }
    })();
    if (
      parsedSourceData.sourceType === "fusion" ||
      parsedSourceData.sourceType === "localhost"
    ) {
      throw new Error(
        "Templates can currently be saved from inline Design projects only.",
      );
    }

    const snapshot = await buildDesignSnapshot(designId, rawData);
    const renderableFiles = snapshot.files.filter((file) =>
      ["html", "jsx", "css"].includes(file.fileType),
    );
    if (renderableFiles.length === 0) {
      throw new Error(
        "Add at least one design screen before saving a template.",
      );
    }

    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("Not authenticated");
    const orgId = getRequestOrgId() ?? null;
    const templateId = nanoid();
    const now = new Date().toISOString();
    const fileIdMap = new Map(
      snapshot.files.map((file) => [file.id, nanoid()]),
    );
    const data = remapTemplateFileIds(
      redactTemplateDesignData(rawData),
      fileIdMap,
    );
    const preferredFile =
      snapshot.files.find((file) => file.filename === "index.html") ??
      snapshot.files[0];
    const dimensions = firstTemplateDimensions(
      data,
      preferredFile ? fileIdMap.get(preferredFile.id) : undefined,
    );
    const lockedLayerCount = countLockedLayersAcrossFiles(snapshot.files);

    const db = getDb();
    await db.transaction(async (tx) => {
      await tx.insert(schema.designTemplates).values({
        id: templateId,
        title: title ?? String(source.title ?? "Untitled template"),
        description:
          description ??
          (typeof source.description === "string" ? source.description : null),
        category,
        sourceDesignId: designId,
        designSystemId:
          typeof source.designSystemId === "string"
            ? source.designSystemId
            : null,
        data: JSON.stringify(data),
        width: dimensions.width,
        height: dimensions.height,
        lockedLayerCount,
        ownerEmail,
        orgId,
        visibility: "private",
        createdAt: now,
        updatedAt: now,
      });
      await tx.insert(schema.designTemplateFiles).values(
        snapshot.files.map((file) => ({
          id: fileIdMap.get(file.id)!,
          templateId,
          filename: file.filename,
          content: file.content,
          fileType: file.fileType,
          createdAt: now,
          updatedAt: now,
        })),
      );
    });

    return {
      id: templateId,
      title: title ?? source.title,
      category,
      width: dimensions.width,
      height: dimensions.height,
      fileCount: snapshot.files.length,
      lockedLayerCount,
    };
  },
  link: ({ result }) => {
    if (!result || typeof result !== "object") return null;
    const id = (result as { id?: string }).id;
    if (!id) return null;
    return {
      url: buildDeepLink({
        app: "design",
        view: "templates",
        params: { templateId: id },
        to: `/templates?templateId=${encodeURIComponent(id)}`,
      }),
      label: "Open template",
      view: "templates",
    };
  },
});
