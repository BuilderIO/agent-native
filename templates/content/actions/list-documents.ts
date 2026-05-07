import { defineAction } from "@agent-native/core";
import { asc } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { parseDocumentFavorite } from "../server/lib/documents.js";
import { accessFilter } from "@agent-native/core/sharing";
import { z } from "zod";

function contentPreview(content: string, maxLength = 180) {
  const compact = content.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength).trimEnd()}...`;
}

export default defineAction({
  description:
    "List document metadata ordered by position. Does not return full document bodies; use get-document for one document's content.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    const db = getDb();
    const documents = await db
      .select()
      .from(schema.documents)
      .where(accessFilter(schema.documents, schema.documentShares))
      .orderBy(asc(schema.documents.position));

    const mapped = documents.map((d) => ({
      id: d.id,
      parentId: d.parentId,
      title: d.title,
      contentPreview: contentPreview(d.content),
      contentLength: d.content.length,
      icon: d.icon,
      position: d.position,
      isFavorite: parseDocumentFavorite(d.isFavorite),
      visibility: d.visibility,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    }));

    return { documents: mapped };
  },
});
