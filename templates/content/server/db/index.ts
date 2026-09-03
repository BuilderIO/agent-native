import { createGetDb } from "@agent-native/core/db";
import { registerShareableResource } from "@agent-native/core/sharing";
import { inArray } from "drizzle-orm";

import { collectDocumentSubtreeIds } from "../../actions/set-document-discoverability.js";
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
  agentReadable: {
    resourceKind: DOCUMENT_AGENT_RESOURCE_KIND,
    getContextPath: () => DOCUMENT_AGENT_CONTEXT_ENDPOINT,
    getPagePath: (document) => `/p/${document.id}`,
  },
  persistVisibilityChange: async ({ resource, resourceId, update }) => {
    const ids = await collectDocumentSubtreeIds({
      db: getDb(),
      rootId: resourceId,
      ownerEmail: resource.ownerEmail,
    });
    await getDb()
      .update(schema.documents)
      .set(update)
      .where(inArray(schema.documents.id, ids));
  },
  getDb,
});
