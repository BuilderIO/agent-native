import { defineEventHandler, setResponseHeader, setResponseStatus } from "h3";

/** PR4 fails closed. PR5 replaces this with cryptographic endpoint authentication. */
export default defineEventHandler((event) => {
  setResponseHeader(event, "Cache-Control", "no-store");
  setResponseHeader(event, "Referrer-Policy", "no-referrer");
  setResponseHeader(event, "X-Content-Type-Options", "nosniff");
  setResponseStatus(event, 503);
  return { error: "Request unavailable" };
});
