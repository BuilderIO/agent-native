import { defineAction } from "@agent-native/core";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server/request-context";
import { resolveAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

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

    // Fetch source files first so we can remap canvasFrames before inserting
    const files = await db
      .select()
      .from(schema.designFiles)
      .where(eq(schema.designFiles.designId, id));

    // Build old-to-new file ID mapping upfront
    const idMap = new Map<string, string>(
      files.map((file) => [file.id, nanoid()]),
    );

    // Remap canvasFrames keys in source.data from old IDs to new IDs
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

    // Copy the design with remapped canvasFrames
    await db.insert(schema.designs).values({
      id: newId,
      title: newTitle,
      description: source.description,
      projectType: source.projectType,
      designSystemId: source.designSystemId ?? null,
      data: newData,
      ownerEmail: (() => {
        const e = getRequestUserEmail();
        if (!e) throw new Error("no authenticated user");
        return e;
      })(),
      orgId: getRequestOrgId() || null,
      createdAt: now,
      updatedAt: now,
    });

    // Copy all associated files using the pre-generated IDs
    for (const file of files) {
      await db.insert(schema.designFiles).values({
        id: idMap.get(file.id)!,
        designId: newId,
        filename: file.filename,
        fileType: file.fileType,
        content: file.content,
        createdAt: now,
        updatedAt: now,
      });
    }

    return {
      id: newId,
      title: newTitle,
      fileCount: files.length,
    };
  },
});
