import { defineEventHandler, setResponseHeader, setResponseStatus } from "h3";

/** No header, path, or body value is accepted as endpoint identity. */
export default defineEventHandler((event) => {
  setResponseHeader(event, "Cache-Control", "no-store");
  setResponseHeader(event, "Referrer-Policy", "no-referrer");
  setResponseHeader(event, "X-Content-Type-Options", "nosniff");
  setResponseStatus(event, 503);
  return { error: "Request unavailable" };
});
