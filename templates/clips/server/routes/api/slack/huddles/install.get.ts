import { defineEventHandler, getQuery, type H3Event } from "h3";

import { buildSlackHuddlesInstallUrl } from "../../../../lib/slack-huddle-oauth.js";

// Start "Connect Slack for huddles".
export default defineEventHandler(async (event: H3Event) => {
  const result = await buildSlackHuddlesInstallUrl(event);
  if (typeof result !== "string") return result;

  if (getQuery(event).redirect === "1") {
    // Carry the flow cookie on the redirect itself (as core's OAuth starts
    // do), and drop it from the staged headers so it is not sent twice.
    const headers = new Headers({ Location: result });
    for (const cookie of event.res.headers.getSetCookie()) {
      headers.append("set-cookie", cookie);
    }
    event.res.headers.delete("set-cookie");
    return new Response(null, { status: 302, headers });
  }
  return { url: result };
});
