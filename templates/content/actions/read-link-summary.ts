import { answerLinkSummaries } from "@agent-native/core/a2a";
import { defineAction } from "@agent-native/core/action";
import { getConfiguredAppBasePath } from "@agent-native/core/server";
import {
  linkSummaryRequestSchema,
  linkSummaryResultSchema,
} from "@agent-native/core/shared";
import { eq } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import { resolveContentDocumentAccess } from "./_content-document-access.js";
import { isSoftDeletedDatabaseDocument } from "./_database-utils.js";
import { resolveDocumentAccess } from "./_document-access.js";

export default defineAction({
  description:
    "Summarize Content page links for another app, as the caller: each page's title when the caller can open it, otherwise only unavailable. Reads titles; changes nothing.",
  schema: linkSummaryRequestSchema,
  outputSchema: linkSummaryResultSchema,
  http: false,
  readOnly: true,
  agentTool: false,
  mcpTool: "search",
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: async ({ links }) =>
    answerLinkSummaries({
      app: "content",
      links,
      basePath: getConfiguredAppBasePath(),
      readTitle: async ({ id }) => {
        const access =
          (await resolveDocumentAccess(id, { skipResourceBody: true })) ??
          (await resolveContentDocumentAccess(id));
        if (
          !access ||
          access.resource.trashedAt ||
          (await isSoftDeletedDatabaseDocument(id))
        ) {
          return null;
        }
        // guard:allow-unscoped — the access check above decided this reader may open the page; this reads its title.
        const rows = await getDb()
          .select({ title: schema.documents.title })
          .from(schema.documents)
          .where(eq(schema.documents.id, id))
          .limit(1);
        for (const row of rows) return row.title.trim() || "Untitled";
        return null;
      },
    }),
});
