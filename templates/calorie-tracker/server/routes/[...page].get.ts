import { createRequestHandler } from "react-router";
import {
  defineEventHandler,
  getRequestURL,
  sendRedirect,
  toWebRequest,
} from "h3";

const handler = createRequestHandler(
  // In dev: Vite resolves this virtual module for HMR.
  // In production: Nitro's build aliases this to build/server/index.js.
  () => import("virtual:react-router/server-build"),
);

export default defineEventHandler(async (event) => {
  // Ignore /.well-known/ requests (Chrome DevTools probes) — they have no
  // matching React Router route and would throw an unhandled error.
  const pathname = getRequestURL(event).pathname;
  if (pathname.startsWith("/.well-known/")) {
    return new Response(null, { status: 404 });
  }
  // Use event.web.request for Web-standard runtimes (Netlify, CF Workers),
  // fall back to toWebRequest for Node.js where event.node exists
  const webReq = (event as any).web?.request ?? toWebRequest(event);
  try {
    return await handler(webReq);
  } catch {
    return sendRedirect(event, "/");
  }
});
