import { defineAction } from "@agent-native/core/action";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server/request-context";
import { resolveAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { annotateScreenHtmlForPersist } from "../shared/screen-annotation.js";

export default defineAction({
  description:
    "Duplicate an existing design project, creating a deep copy with new IDs " +
    "for the design and all its files. Returns the new design's ID and title.",
  schema: z.object({
    id: z.string().describe("Source design ID to duplicate"),
    title: z
      .string()
      .optional()
      .describe("Title for the copy (defaults to 'Copy of ...')"),
  }),
  run: async ({ id, title }) => {
    const access = await resolveAccess("design", id);
    if (!access) throw new Error(`Design not found: ${id}`);

    const source = access.resource;
    const db = getDb();
    const newId = nanoid();
    const now = new Date().toISOString();
    const newTitle = title || `Copy of ${source.title}`;

    const files = await db
      .select()
      .from(schema.designFiles)
      .where(eq(schema.designFiles.designId, id));

    const idMap = new Map<string, string>(
      files.map((file) => [file.id, nanoid()]),
    );

    let newData = source.data;
    try {
      const parsed =
        typeof source.data === "string" ? JSON.parse(source.data) : source.data;
      if (parsed && typeof parsed === "object" && parsed.canvasFrames) {
        const remapped: Record<string, unknown> = {};
        for (const [oldId, geometry] of Object.entries(parsed.canvasFrames)) {
          const newFileId = idMap.get(oldId);
          remapped[newFileId ?? oldId] = geometry;
        }
        newData =
          typeof source.data === "string"
            ? JSON.stringify({ ...parsed, canvasFrames: remapped })
            : { ...parsed, canvasFrames: remapped };
      }
    } catch {
      // If data is unparseable, fall back to copying verbatim
    }

    const orgId = getRequestOrgId() || null;
    const ownerEmail = (() => {
      const e = getRequestUserEmail();
      if (!e) throw new Error("no authenticated user");
      return e;
    })();

    await db.transaction(async (tx) => {
      await tx.insert(schema.designs).values({
        id: newId,
        title: newTitle,
        description: source.description,
        projectType: source.projectType,
        designSystemId: source.designSystemId ?? null,
        data: newData,
        ownerEmail,
        orgId,
        visibility: orgId ? "org" : "private",
        createdAt: now,
        updatedAt: now,
      });

      if (files.length > 0) {
        await tx.insert(schema.designFiles).values(
          files.map((file) => ({
            id: idMap.get(file.id)!,
            designId: newId,
            filename: file.filename,
            fileType: file.fileType,
            content: annotateScreenHtmlForPersist(file.content, file.fileType),
            createdAt: now,
            updatedAt: now,
          })),
        );
      }
    });

    return {
      id: newId,
      title: newTitle,
      fileCount: files.length,
    };
  },
});
