import { createRequestHandler } from "react-router";
import { defineEventHandler, sendRedirect, toWebRequest } from "h3";

const handler = createRequestHandler(
  // virtual module provided by React Router Vite plugin
  () => import("virtual:react-router/server-build"),
);

export default defineEventHandler(async (event) => {
  // Ignore /.well-known/ requests (Chrome DevTools probes) — they have no
  // matching React Router route and would throw an unhandled error.
  const url = event.node.req.url ?? "";
  if (url.startsWith("/.well-known/")) {
    event.node.res.statusCode = 404;
    event.node.res.end();
    return;
  }
  const webReq = toWebRequest(event);
  try {
    return await handler(webReq);
  } catch {
    return sendRedirect(event, "/");
  }
});
