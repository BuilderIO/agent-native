import { defineEventHandler, setHeaders, getRequestURL } from "h3";

/**
 * CORS middleware — allows cross-origin requests so other templates
 * (e.g. Clips) can call meeting-notes APIs.
 */
export default defineEventHandler((event) => {
  const origin = event.node.req.headers.origin;
  if (origin) {
    setHeaders(event, {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, X-Requested-With",
      "Access-Control-Allow-Credentials": "true",
    });
  }

  // Handle preflight
  if (event.node.req.method === "OPTIONS") {
    event.node.res.statusCode = 204;
    event.node.res.end();
    return;
  }
});
