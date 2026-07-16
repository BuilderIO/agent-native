import {
  AGENT_ACCESS_PARAM,
  getConfiguredAppBasePath,
  verifyScopedAgentAccessToken,
} from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import {
  defineEventHandler,
  getQuery,
  setResponseHeader,
  setResponseStatus,
} from "h3";

import {
  buildContentPublicDocumentUrl,
  DOCUMENT_AGENT_RESOURCE_KIND,
} from "../../../shared/agent-readable.js";
import { getDb, schema } from "../../db/index.js";
import { getDocumentContextPath } from "../../lib/document-context.js";

function queryString(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return "";
}

const NOT_FOUND = { error: "Document not found" };

function notFound(event: Parameters<typeof setResponseStatus>[0]) {
  setResponseStatus(event, 404);
  return NOT_FOUND;
}

export default defineEventHandler(async (event) => {
  setResponseHeader(event, "Cache-Control", "no-store");
  setResponseHeader(event, "Referrer-Policy", "no-referrer");
  setResponseHeader(event, "X-Content-Type-Options", "nosniff");

  const query = getQuery(event);
  const id = queryString(query.id);
  if (!id) {
    setResponseStatus(event, 400);
    return { error: "Document id is required" };
  }

  const token = queryString(query[AGENT_ACCESS_PARAM]);
  const db = getDb();
  // guard:allow-unscoped -- this endpoint returns a document only when it is public or a document-scoped agent_access token verifies for this id.
  const [document] = await db
    .select({
      id: schema.documents.id,
      parentId: schema.documents.parentId,
      title: schema.documents.title,
      description: schema.documents.description,
      content: schema.documents.content,
      icon: schema.documents.icon,
      visibility: schema.documents.visibility,
      updatedAt: schema.documents.updatedAt,
      createdAt: schema.documents.createdAt,
    })
    .from(schema.documents)
    .where(eq(schema.documents.id, id))
    .limit(1);

  if (!document) {
    return notFound(event);
  }

  const tokenAccess = token
    ? verifyScopedAgentAccessToken(token, {
        resourceKind: DOCUMENT_AGENT_RESOURCE_KIND,
        resourceId: id,
      }).ok
    : false;
  if (document.visibility !== "public" && !tokenAccess) {
    return notFound(event);
  }

  return {
    resourceType: "document",
    id: document.id,
    title: document.title,
    description: document.description,
    icon: document.icon,
    content: document.content,
    visibility: document.visibility,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    contextPath: await getDocumentContextPath(document),
    url: buildContentPublicDocumentUrl(document.id, {
      basePath: getConfiguredAppBasePath(),
      token: tokenAccess ? token : null,
    }),
  };
});
