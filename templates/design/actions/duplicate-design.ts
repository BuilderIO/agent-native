import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { resolveAccess } from "@agent-native/core/sharing";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server/request-context";
import { nanoid } from "nanoid";

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

    // Copy the design
    await db.insert(schema.designs).values({
      id: newId,
      title: newTitle,
      description: source.description,
      projectType: source.projectType,
      designSystemId: source.designSystemId ?? null,
      data: source.data,
      ownerEmail: (() => {
        const e = getRequestUserEmail();
        if (!e) throw new Error("no authenticated user");
        return e;
      })(),
      orgId: getRequestOrgId() || null,
      createdAt: now,
      updatedAt: now,
    });

    // Copy all associated files with new IDs
    const files = await db
      .select()
      .from(schema.designFiles)
      .where(eq(schema.designFiles.designId, id));

    for (const file of files) {
      await db.insert(schema.designFiles).values({
        id: nanoid(),
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
