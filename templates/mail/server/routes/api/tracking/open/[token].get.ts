import {
  defineEventHandler,
  getRouterParam,
  getHeader,
  setResponseHeader,
  type H3Event,
} from "h3";
import { recordOpen } from "../../../../lib/email-tracking.js";

// 43-byte 1x1 transparent GIF
const PIXEL_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

export default defineEventHandler(async (event: H3Event) => {
  const token = getRouterParam(event, "token");
  if (token) {
    const ua = getHeader(event, "user-agent") || "";
    try {
      await recordOpen(token, ua);
    } catch {
      // Never fail the pixel — it must always return an image.
    }
  }
  setResponseHeader(event, "Content-Type", "image/gif");
  setResponseHeader(
    event,
    "Cache-Control",
    "private, no-cache, no-store, must-revalidate, max-age=0",
  );
  setResponseHeader(event, "Pragma", "no-cache");
  setResponseHeader(event, "Expires", "0");
  return PIXEL_GIF;
});
