import { createRequestHandler } from "react-router";
import { defineEventHandler, sendRedirect, toWebRequest } from "h3";
import { renderPublicForm } from "../lib/public-form-ssr.js";

const handler = createRequestHandler(
  // virtual module provided by React Router Vite plugin
  () => import("virtual:react-router/server-build"),
);

export default defineEventHandler(async (event) => {
  const url = event.node.req.url ?? "";

  // Ignore /.well-known/ requests (Chrome DevTools probes) — they have no
  // matching React Router route and would throw an unhandled error.
  if (url.startsWith("/.well-known/")) {
    event.node.res.statusCode = 404;
    event.node.res.end();
    return;
  }

  // SSR public form pages — /f/optionalSlug/formId
  if (url.startsWith("/f/")) {
    return renderPublicForm(event);
  }

  const webReq = toWebRequest(event);
  try {
    return await handler(webReq);
  } catch {
    return sendRedirect(event, "/");
  }
});
