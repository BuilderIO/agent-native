import {
  defineEventHandler,
  getMethod,
  getRequestURL,
  setResponseHeader,
} from "h3";

const PUBLIC_EMBED_PREFIXES = [
  "/api/forms/public/",
  "/api/upload/",
  "/api/submit/",
];

export default defineEventHandler((event) => {
  const pathname = getRequestURL(event).pathname;
  const isPublic = PUBLIC_EMBED_PREFIXES.some((p) => pathname.startsWith(p));
  if (!isPublic) return;

  setResponseHeader(event, "Access-Control-Allow-Origin", "*");
  setResponseHeader(event, "Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  setResponseHeader(
    event,
    "Access-Control-Allow-Headers",
    "Content-Type,Accept,Idempotency-Key",
  );

  if (getMethod(event) === "OPTIONS") {
    return new Response(null, { status: 204 });
  }
});
