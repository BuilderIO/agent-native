import { mutateUserSetting } from "@agent-native/core/settings";
import {
  defineEventHandler,
  getQuery,
  setResponseHeaders,
  setResponseStatus,
} from "h3";

import { CLIPS_USER_PREFS_KEY } from "../../../shared/clips-ai-prefs.js";
import { readClipsNotificationOptOutToken } from "../../lib/notification-preferences.js";

const INVALID_LINK_MESSAGE =
  "This Clips notification link is invalid or has expired.";

function htmlPage(title: string, message: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head><body><main><h1>${title}</h1><p>${message}</p></main></body></html>`;
}

export default defineEventHandler(async (event) => {
  setResponseHeaders(event, {
    "Cache-Control": "no-store",
    "Content-Type": "text/html; charset=utf-8",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });

  const query = getQuery(event);
  const token = typeof query.token === "string" ? query.token : null;
  const claims = readClipsNotificationOptOutToken(token, "views");
  if (!claims) {
    setResponseStatus(event, 400);
    return htmlPage("Link not valid", INVALID_LINK_MESSAGE);
  }

  await mutateUserSetting(claims.email, CLIPS_USER_PREFS_KEY, (current) => ({
    ...(current ?? {}),
    viewNotifications: false,
  }));

  return htmlPage(
    "Clip view emails are off",
    "You will no longer receive optional email notifications when someone views your Clips. You can change this anytime in Clips settings.",
  );
});
