/**
 * Shared SSR catch-all route handler for React Router.
 *
 * In h3 v2, `event.req` IS the web Request and `event.url` is a parsed URL,
 * so this is straightforward — we just hand them off to React Router.
 */
import { createRequestHandler } from "react-router";
import { defineEventHandler } from "h3";

const handler = createRequestHandler(
  // @ts-expect-error — virtual module provided by React Router Vite plugin at build time
  () => import("virtual:react-router/server-build"),
);

/**
 * Default SSR catch-all handler. Ignores /.well-known/ probes and renders
 * all other routes through React Router.
 */
export const ssrHandler = defineEventHandler(async (event) => {
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
  } catch {
    return new Response(null, {
      status: 302,
      headers: { Location: "/" },
    });
  }
});

/**
 * Create an SSR handler with the React Router request handler pre-initialized.
 * Useful when you need to call the SSR handler from a custom route.
 */
export function createSSRRequestHandler() {
  return (event: any) => handler(event.req as Request);
}
