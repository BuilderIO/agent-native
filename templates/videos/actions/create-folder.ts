import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { nanoid } from "nanoid";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server/request-context";
import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description: "Create a new library folder for organizing compositions.",
  schema: z.object({
    name: z.string().describe("Folder name"),
    id: z
      .string()
      .optional()
      .describe(
        "Optional folder id. Pass a client-generated id for optimistic UI.",
      ),
  }),
  run: async ({ name, id }) => {
    const trimmed = name.trim() || "New Folder";
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");

    const db = getDb();
    const folderId = id ?? nanoid();
    const now = new Date().toISOString();

    await db.insert(schema.folders).values({
      id: folderId,
      name: trimmed,
      createdAt: now,
      updatedAt: now,
      ownerEmail,
      orgId: getRequestOrgId(),
    });

    return {
      id: folderId,
      name: trimmed,
      createdAt: now,
      updatedAt: now,
      compositionIds: [] as string[],
    };
  },
});
