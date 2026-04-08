import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { parseDocumentFavorite } from "../server/lib/documents.js";

export default defineAction({
  description: "Get a single document by ID with full content.",
  parameters: {
    id: { type: "string", description: "Document ID (required)" },
  },
  http: { method: "GET" },
  run: async (args) => {
    if (!args.id) throw new Error("--id is required");

    const db = getDb();
    const [doc] = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, args.id));

    if (!doc) throw new Error(`Document "${args.id}" not found`);

    return {
      id: doc.id,
      parentId: doc.parentId,
      title: doc.title,
      content: doc.content,
      icon: doc.icon,
      position: doc.position,
      isFavorite: parseDocumentFavorite(doc.isFavorite),
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  },
});
