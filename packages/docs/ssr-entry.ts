import { createRequestHandler } from "react-router";

import { wrapDocumentResponse } from "./lib/analytics";

const handler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
);

export default {
  async fetch(request: Request) {
    return wrapDocumentResponse(await handler(request));
  },
};
