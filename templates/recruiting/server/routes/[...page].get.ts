import { createRequestHandler } from "react-router";
import { defineEventHandler, toWebRequest } from "h3";

const handler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
);

export default defineEventHandler(async (event) => {
  const url = event.node.req.url ?? "";
  if (url.startsWith("/.well-known/")) {
    event.node.res.statusCode = 404;
    event.node.res.end();
    return;
  }
  const webReq = toWebRequest(event);
  return handler(webReq);
});
