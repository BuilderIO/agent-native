import { createGetDb } from "@agent-native/core/db";
import { registerSearchableResource } from "@agent-native/core/search";
import { registerShareableResource } from "@agent-native/core/sharing";
import { inArray } from "drizzle-orm";

import {
  DOCUMENT_AGENT_CONTEXT_ENDPOINT,
  DOCUMENT_AGENT_RESOURCE_KIND,
} from "../../shared/agent-readable.js";
import * as schema from "./schema.js";

export const getDb = createGetDb(schema);
export { schema };

registerShareableResource({
  type: "document",
  resourceTable: schema.documents,
  sharesTable: schema.documentShares,
  displayName: "Document",
  titleColumn: "title",
  getResourcePath: (document) => `/page/${document.id}`,
  ownerAccessIgnoresOrg: true,
  // A trashed page reads as missing to anyone who can't open it.
  availability: {
    columns: ["trashedAt"],
    isAvailable: (document) => !document.trashedAt,
  },
  agentReadable: {
    resourceKind: DOCUMENT_AGENT_RESOURCE_KIND,
    getContextPath: () => DOCUMENT_AGENT_CONTEXT_ENDPOINT,
    getPagePath: (document) => `/p/${document.id}`,
  },
  getDb,
});

/**
 * Documents in the core search index. Every row is indexed, including trashed
 * and hidden ones; `search-documents` applies access and filters live.
 */
export const documentSearchIndex = registerSearchableResource({
  app: "content",
  type: "document",
  table: schema.documents,
  idColumn: schema.documents.id,
  version: 1,
  load: async (ids) => {
    // guard:allow-unscoped — the indexer projects changed documents by id with no caller; search-documents applies access live when reading the index.
    const rows = await getDb()
      .select({
        id: schema.documents.id,
        title: schema.documents.title,
        description: schema.documents.description,
        content: schema.documents.content,
        updatedAt: schema.documents.updatedAt,
      })
      .from(schema.documents)
      .where(inArray(schema.documents.id, ids));
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      summary: row.description,
      body: row.content,
      modifiedAt: row.updatedAt,
    }));
  },
});
