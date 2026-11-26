import {
  isPrivateMediaId,
  openPrivateMediaForAuthorizedReader,
  ownsPrivateMedia,
  PRIVATE_MEDIA_SVG_CSP,
} from "@agent-native/core/private-media";
import {
  AGENT_ACCESS_PARAM,
  getSession,
  runWithRequestContext,
} from "@agent-native/core/server";
import {
  createError,
  defineEventHandler,
  getQuery,
  sendRedirect,
  setResponseHeader,
} from "h3";

import {
  canReadPrivateMediaThroughComment,
  liveCommentCarriesPrivateMedia,
} from "../../../lib/comment-images.js";
import {
  agentLinkOpensCommentImage,
  agentLinkOpensPrivateMedia,
} from "../../../lib/private-media-agent-links.js";
import { canReadPrivateMediaThroughDocument } from "../../../lib/private-media-references.js";

const RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

const STORAGE_TIMEOUT_MS = 15_000;

export default defineEventHandler(async (event) => {
  for (const [name, value] of Object.entries(RESPONSE_HEADERS)) {
    setResponseHeader(event, name, value);
  }
  const id = event.context.params?.id ?? "";
  // A refusal must not be cached either: the page may be shared a moment later.
  const notFound = () =>
    createError({
      statusCode: 404,
      statusMessage: "Image not found",
      headers: RESPONSE_HEADERS,
    });
  if (!isPrivateMediaId(id)) throw notFound();
  const session = await getSession(event);
  return runWithRequestContext(
    {
      ...(session?.email ? { userEmail: session.email } : {}),
      ...(session?.orgId ? { orgId: session.orgId } : {}),
    },
    async () => {
      const query = getQuery(event)[AGENT_ACCESS_PARAM];
      const token = typeof query === "string" ? query : "";
      const readable =
        agentLinkOpensPrivateMedia(token, id) ||
        (!!token &&
          (await liveCommentCarriesPrivateMedia(id, (documentId) =>
            agentLinkOpensCommentImage(token, documentId, id),
          ))) ||
        (await canReadPrivateMediaThroughDocument(id)) ||
        (await canReadPrivateMediaThroughComment(id)) ||
        (await ownsPrivateMedia(id, session?.email));
      if (!readable) throw notFound();
      const opened = await openPrivateMediaForAuthorizedReader(id);
      if (!opened) throw notFound();
      const bytes = getQuery(event).bytes === "1";
      if (opened.kind === "redirect" && !bytes) {
        return sendRedirect(event, opened.url, 302);
      }
      setResponseHeader(event, "Content-Type", opened.media.mimeType);
      if (opened.media.mimeType === "image/svg+xml") {
        setResponseHeader(
          event,
          "Content-Security-Policy",
          PRIVATE_MEDIA_SVG_CSP,
        );
      }
      if (opened.kind === "bytes") return Buffer.from(opened.data);
      const stored = await fetch(opened.url, {
        signal: AbortSignal.timeout(STORAGE_TIMEOUT_MS),
      });
      const data = stored.ok ? Buffer.from(await stored.arrayBuffer()) : null;
      if (data?.byteLength !== opened.media.size) {
        throw createError({
          statusCode: 502,
          statusMessage: "Image storage did not answer with the image",
          headers: RESPONSE_HEADERS,
        });
      }
      return data;
    },
  );
});
