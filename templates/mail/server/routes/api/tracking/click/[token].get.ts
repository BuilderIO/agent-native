import {
  defineEventHandler,
  getRouterParam,
  sendRedirect,
  type H3Event,
} from "h3";
import { recordClick } from "../../../../lib/email-tracking.js";

export default defineEventHandler(async (event: H3Event) => {
  const token = getRouterParam(event, "token");
  if (!token) {
    return sendRedirect(event, "/", 302);
  }
  try {
    const url = await recordClick(token);
    if (url) return sendRedirect(event, url, 302);
  } catch {
    // Fall through to safe redirect
  }
  return sendRedirect(event, "/", 302);
});
