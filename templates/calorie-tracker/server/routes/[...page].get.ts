import { createRequestHandler } from "react-router";
import { defineEventHandler } from "h3";

const handler = createRequestHandler(
  // In dev: Vite resolves this virtual module for HMR.
  // In production: Nitro's build aliases this to build/server/index.js.
  () => import("virtual:react-router/server-build"),
);

export default defineEventHandler(async (event) => {
  // Get the Web Request directly — avoid H3 helpers like getRequestURL()
  // and toWebRequest() which access event.node.req internally and crash
  // on Web-standard runtimes (Netlify Functions v2, CF Workers).
  const req: Request = (event as any).web?.request ?? (event as any)._request;
  if (!req) {
    // Node.js fallback — dynamically import toWebRequest only when needed
    const { toWebRequest } = await import("h3");
    const webReq = toWebRequest(event);
    return handler(webReq);
  }
  const url = new URL(req.url);
  if (url.pathname.startsWith("/.well-known/")) {
    return new Response(null, { status: 404 });
  }
  try {
    return await handler(req);
  } catch {
    return Response.redirect(url.origin + "/", 302);
  }
});
