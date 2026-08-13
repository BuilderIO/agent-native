/**
 * `require-corp` makes the browser reject any subframe that has not opted in via
 * CORP, and the container previews this canvas frames cannot be made to opt in.
 * The `response` hook, not `server/middleware/`: core sets its security headers
 * from a plugin, which runs later and would overwrite this.
 */
import { verifyEmbedSessionToken } from "@agent-native/core/server";
import {
  EMBED_SESSION_COOKIE,
  EMBED_TOKEN_QUERY_PARAM,
} from "@agent-native/core/shared";
import { getCookie, getQuery, type H3Event } from "h3";

import { BUILDER_HOST_EMBED_SCOPE_PREFIX } from "../lib/builder-host-embed.js";

function isBuilderHostEmbedRequest(event: H3Event): boolean {
  const queryToken = (getQuery(event) ?? {})[EMBED_TOKEN_QUERY_PARAM];
  const candidates = [
    Array.isArray(queryToken) ? queryToken[0] : queryToken,
    getCookie(event, EMBED_SESSION_COOKIE),
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== "string" || !candidate) continue;
    const verified = verifyEmbedSessionToken(candidate);
    if (
      verified.ok &&
      verified.claims.scope?.startsWith(BUILDER_HOST_EMBED_SCOPE_PREFIX)
    ) {
      return true;
    }
  }
  return false;
}

export default (nitroApp: any): void => {
  nitroApp.hooks.hook("response", (res: Response, event: H3Event) => {
    // Cheap gate first: only embed and iframe navigations carry COEP at all,
    // so ordinary traffic never reaches the token verification below.
    if (res.headers.get("cross-origin-embedder-policy") !== "require-corp") {
      return;
    }
    if (!isBuilderHostEmbedRequest(event)) return;
    res.headers.set("Cross-Origin-Embedder-Policy", "unsafe-none");
  });
};
