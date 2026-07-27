import {
  defineEventHandler,
  getQuery,
  setResponseStatus,
  type H3Event,
} from "h3";

import { buildSlackOAuthInstallUrl } from "../../../../lib/slack-oauth.js";

function oauthRedirectResponse(url: string) {
  return new Response(null, {
    status: 302,
    headers: { Location: url },
  });
}

export default defineEventHandler(async (event: H3Event) => {
  const result = await buildSlackOAuthInstallUrl(event);
  if (typeof result !== "string") return result;

  if (getQuery(event).redirect === "1") {
    return oauthRedirectResponse(result);
  }

  setResponseStatus(event, 200);
  return { url: result };
});
