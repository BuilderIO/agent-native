import { defineAction } from "@agent-native/core";
import {
  AGENT_ACCESS_PARAM,
  verifyScopedAgentAccessToken,
} from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { DOCUMENT_AGENT_RESOURCE_KIND } from "../shared/agent-readable.js";

function notFound(): never {
  throw Object.assign(new Error("Document not found"), { statusCode: 404 });
}

/**
 * Reads a document that is intentionally available without a signed-in session.
 * This is UI-only: public-agent protocols must use the dedicated context route.
 */
export default defineAction({
  description: "Read a public or document-token-authorized document.",
  schema: z.object({
    id: z.string().min(1),
    [AGENT_ACCESS_PARAM]: z.string().min(1).optional(),
  }),
  http: { method: "GET" },
  requiresAuth: false,
  agentTool: false,
  toolCallable: false,
  readOnly: true,
  run: async ({ id, [AGENT_ACCESS_PARAM]: token }) => {
    const tokenAccess = token
      ? verifyScopedAgentAccessToken(token, {
          resourceKind: DOCUMENT_AGENT_RESOURCE_KIND,
          resourceId: id,
        }).ok
      : false;

    const [document] = await getDb()
      .select({
        id: schema.documents.id,
        title: schema.documents.title,
        content: schema.documents.content,
        updatedAt: schema.documents.updatedAt,
        visibility: schema.documents.visibility,
      })
      .from(schema.documents)
      // guard:allow-unscoped -- this UI-only public action returns a document only when it is public or a document-scoped agent_access token verifies for this id.
      .where(eq(schema.documents.id, id))
      .limit(1);

    // Missing, private, malformed/expired, and cross-document tokens all use
    // one external shape so callers cannot probe document existence.
    if (!document || (document.visibility !== "public" && !tokenAccess)) {
      notFound();
    }

    return document;
  },
});
