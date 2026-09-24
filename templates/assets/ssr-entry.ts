/**
 * SSR entry point for Nitro.
 *
 * This wraps React Router's request handler so Nitro can use it as an
 * SSR service. The file must be a real file (not a virtual module) so
 * Nitro can resolve it during build.
 *
 * Similar to how TanStack Start provides a server.ts entry for Nitro.
 */
import { createRequestHandler } from "react-router";

const handler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
);

export default {
  async fetch(request: Request) {
    return handler(request);
  },
};
