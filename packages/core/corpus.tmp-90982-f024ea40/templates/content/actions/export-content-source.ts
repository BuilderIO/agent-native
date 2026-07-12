import { defineAction } from "@agent-native/core";
import { accessFilter } from "@agent-native/core/sharing";
import { asc } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  parseDocumentFavorite,
  parseDocumentHideFromSearch,
} from "../server/lib/documents.js";
import {
  buildContentSourceBundle,
  type ContentSourceDocument,
} from "../shared/content-source.js";

export default defineAction({
  description:
    "Export editable Content documents as source-control friendly Markdown/MDX files with frontmatter.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: {
    expose: true,
    readOnly: true,
    requiresAuth: true,
    title: "Export Content Source",
    description:
      "Export Content documents as a local-file source bundle for MDX workflows.",
  },
  run: async () => {
    const rows = await getDb()
      .select()
      .from(schema.documents)
      .where(accessFilter(schema.documents, schema.documentShares))
      .orderBy(asc(schema.documents.position), asc(schema.documents.title));

    const documents: ContentSourceDocument[] = rows.map((doc) => ({
      id: doc.id,
      parentId: doc.parentId,
      title: doc.title,
      content: doc.content,
      icon: doc.icon,
      position: doc.position,
      isFavorite: parseDocumentFavorite(doc.isFavorite),
      hideFromSearch: parseDocumentHideFromSearch(doc.hideFromSearch),
      visibility: doc.visibility,
      updatedAt: doc.updatedAt,
    }));

    return {
      ...buildContentSourceBundle(documents),
      count: documents.length,
    };
  },
});
