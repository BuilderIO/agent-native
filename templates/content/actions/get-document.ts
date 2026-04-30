import { defineAction } from "@agent-native/core";
import { parseDocumentFavorite } from "../server/lib/documents.js";
import { resolveAccess } from "@agent-native/core/sharing";
import { z } from "zod";
import "../server/db/index.js";

export default defineAction({
  description: "Get a single document by ID with full content.",
  schema: z.object({
    id: z.string().optional().describe("Document ID (required)"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    if (!args.id) throw new Error("--id is required");

    const access = await resolveAccess("document", args.id);
    if (!access) throw new Error(`Document "${args.id}" not found`);
    const doc = access.resource;

    return {
      id: doc.id,
      parentId: doc.parentId,
      title: doc.title,
      content: doc.content,
      icon: doc.icon,
      position: doc.position,
      isFavorite: parseDocumentFavorite(doc.isFavorite),
      visibility: doc.visibility,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  },
});
