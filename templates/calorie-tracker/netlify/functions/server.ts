import { createRequestHandler } from "react-router";

const handler = createRequestHandler(
  // @ts-ignore - resolved at build time
  () => import("../../build/server/index.js"),
);

export default async (request: Request) => {
  return handler(request);
};
