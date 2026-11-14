import { defineEventHandler, getQuery, type H3Event } from "h3";

import { buildSlackHuddlesInstallUrl } from "../../../../lib/slack-huddle-oauth.js";

// Start "Connect Slack for huddles".
export default defineEventHandler(async (event: H3Event) => {
  const result = await buildSlackHuddlesInstallUrl(event);
  if (typeof result !== "string") return result;

  if (getQuery(event).redirect === "1") {
    return new Response(null, { status: 302, headers: { Location: result } });
  }
  return { url: result };
});
