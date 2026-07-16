import { readPrivateBlob } from "@agent-native/core/private-blob";
import {
  AGENT_ACCESS_PARAM,
  getSession,
  verifyScopedAgentAccessToken,
} from "@agent-native/core/server";
import { resolveAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import {
  defineEventHandler,
  getQuery,
  getRouterParam,
  setResponseHeader,
  setResponseStatus,
} from "h3";

import { DOCUMENT_AGENT_RESOURCE_KIND } from "../../../../shared/agent-readable.js";
import { getDb, schema } from "../../../db/index.js";
import { parsePrivateBlobHandle } from "../../../lib/document-media.js";

const NOT_FOUND = { error: "Document not found" };
function deny(event: any) {
  setResponseStatus(event, 404);
  return NOT_FOUND;
}

export default defineEventHandler(async (event) => {
  setResponseHeader(event, "Cache-Control", "no-store");
  setResponseHeader(event, "Referrer-Policy", "no-referrer");
  setResponseHeader(event, "X-Content-Type-Options", "nosniff");
  const id = getRouterParam(event, "id");
  if (!id) return deny(event);
  // guard:allow-unscoped -- media is returned only after public/token/session document authorization below.
  const [media] = await getDb()
    .select()
    .from(schema.documentMedia)
    .where(eq(schema.documentMedia.id, id))
    .limit(1);
  if (!media || media.state !== "active") return deny(event);
  const token = getQuery(event)[AGENT_ACCESS_PARAM];
  const tokenValue = typeof token === "string" ? token : "";
  const tokenAccess =
    tokenValue &&
    verifyScopedAgentAccessToken(tokenValue, {
      resourceKind: DOCUMENT_AGENT_RESOURCE_KIND,
      resourceId: media.documentId,
    }).ok;
  const session = await getSession(event).catch(() => null);
  const allowed =
    tokenAccess ||
    (session?.email &&
      Boolean(
        await resolveAccess("document", media.documentId, {
          userEmail: session.email,
          orgId: session.orgId,
        }),
      ));
  if (!allowed) {
    // guard:allow-unscoped -- public visibility is the explicit anonymous authorization path.
    const [document] = await getDb()
      .select({ visibility: schema.documents.visibility })
      .from(schema.documents)
      .where(eq(schema.documents.id, media.documentId))
      .limit(1);
    if (document?.visibility !== "public") return deny(event);
  }
  const handle = parsePrivateBlobHandle(media.blobHandleJson);
  if (!handle) return deny(event);
  try {
    const blob = await readPrivateBlob(handle);
    setResponseHeader(event, "Content-Type", blob.mimeType ?? media.mimeType);
    return blob.data;
  } catch {
    return deny(event);
  }
});
