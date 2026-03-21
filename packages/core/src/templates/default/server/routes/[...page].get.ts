import { createRequestHandler } from "@react-router/node";
import { defineEventHandler } from "h3";

const handler = createRequestHandler(
  // @ts-expect-error — virtual module provided by React Router Vite plugin
  () => import("virtual:react-router/server-build"),
);

export default defineEventHandler(async (event) => {
  return handler(event.node.req, event.node.res);
});
