import {
  isPrivateMediaId,
  openPrivateMediaForAuthorizedReader,
  ownsPrivateMedia,
  PRIVATE_MEDIA_SVG_CSP,
} from "@agent-native/core/private-media";
import { getSession, runWithRequestContext } from "@agent-native/core/server";
import {
  createError,
  defineEventHandler,
  sendRedirect,
  setResponseHeader,
} from "h3";

import { canReadPrivateMediaThroughDocument } from "../../../lib/private-media-references.js";

/**
 * Serves a private image to someone who can view a live page that carries it,
 * or to its uploader. Every refusal is the same 404, so the route never says
 * whether an image exists.
 */
const RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

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
      const readable =
        (await canReadPrivateMediaThroughDocument(id)) ||
        (await ownsPrivateMedia(id, session?.email));
      if (!readable) throw notFound();
      const opened = await openPrivateMediaForAuthorizedReader(id);
      if (!opened) throw notFound();
      if (opened.kind === "redirect") {
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
      return Buffer.from(opened.data);
    },
  );
});
