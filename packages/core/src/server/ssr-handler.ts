/**
 * Shared SSR catch-all handler for React Router framework mode.
 *
 * Templates wire this up via:
 *
 *   // server/routes/[...page].get.ts
 *   import { createH3SSRHandler } from "@agent-native/core/server";
 *   export default createH3SSRHandler(
 *     // @ts-expect-error virtual module
 *     () => import("virtual:react-router/server-build"),
 *   );
 *
 * The `getBuild` callback MUST live in the template's own source so Vite's
 * @react-router/dev plugin can resolve the `virtual:` module. Pulling the
 * import into core (e.g. via a re-export) puts it in node_modules where
 * Vite's SSR externalizer leaves it untouched and Node's ESM loader rejects
 * the unknown scheme — silently 302'ing every request to "/".
 */
import { createRequestHandler } from "react-router";
import { defineEventHandler } from "h3";

/**
 * Create an h3 catch-all that hands page routes to React Router and
 * returns 404 for framework / asset paths that React Router doesn't own.
 */
export function createH3SSRHandler(
  getBuild: () => Promise<unknown> | unknown,
) {
  const handler = createRequestHandler(getBuild as any);
  return defineEventHandler(async (event) => {
    const p = event.url.pathname;
    if (
      p.startsWith("/.well-known/") ||
      p.startsWith("/_agent-native/") ||
      p.startsWith("/api/") ||
      p === "/favicon.ico" ||
      p === "/favicon.png"
    ) {
      return new Response(null, { status: 404 });
    }
    try {
      return await handler(event.req as Request);
    } catch (err) {
      console.error("[ssr-handler] SSR error:", err);
      return new Response(
        `SSR error: ${(err as Error)?.stack ?? err}`,
        {
          status: 500,
          headers: { "content-type": "text/plain" },
        },
      );
    }
  });
}
