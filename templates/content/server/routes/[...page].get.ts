import { createRequestHandler } from "react-router";
import { defineEventHandler, toWebRequest } from "h3";

const handler = createRequestHandler(
  // virtual module provided by React Router Vite plugin
  () => import("virtual:react-router/server-build"),
);

export default defineEventHandler(async (event) => {
  const webReq = toWebRequest(event);
  return handler(webReq);
});
