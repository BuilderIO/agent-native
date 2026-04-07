import { createRequestHandler } from "react-router";
import { defineEventHandler, getRequestURL, sendRedirect } from "h3";

const handler = createRequestHandler(
  // In dev: Vite resolves this virtual module for HMR.
  // In production: Nitro's build aliases this to build/server/index.js.
  () => import("virtual:react-router/server-build"),
);

export default defineEventHandler(async (event) => {
  const url = getRequestURL(event);
  if (url.pathname.startsWith("/.well-known/")) {
    return new Response(null, { status: 404 });
  }
  // Build a standard Web Request from the H3 event.
  // Avoids toWebRequest() which crashes on Web-standard runtimes
  // where event.node is undefined (Netlify Functions v2, CF Workers).
  const webReq =
    (event as any).web?.request ??
    new Request(url.href, {
      method: event.method,
      headers: event.headers,
    });
  try {
    return await handler(webReq);
  } catch {
    return sendRedirect(event, "/");
  }
});
