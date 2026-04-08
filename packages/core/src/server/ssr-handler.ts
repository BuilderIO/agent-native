/**
 * Shared SSR catch-all route handler for React Router.
 *
 * Works in both Node.js (dev) and web-standard runtimes (Netlify Functions v2,
 * Cloudflare Workers, etc.) by avoiding H3 helpers that depend on event.node.
 */
import { createRequestHandler } from "react-router";
import { defineEventHandler } from "h3";

const handler = createRequestHandler(
  // @ts-expect-error — virtual module provided by React Router Vite plugin at build time
  () => import("virtual:react-router/server-build"),
);

/**
 * Convert an H3 event to a web Request, compatible with both Node and web runtimes.
 */
function toRequest(event: any): Request {
  if (event.req instanceof Request) return event.req;
  return new Request(event.url.href, {
    method: event.method,
    headers: event.headers,
  });
}

/**
 * Default SSR catch-all handler. Ignores /.well-known/ probes and renders
 * all other routes through React Router.
 */
export const ssrHandler = defineEventHandler(async (event: any) => {
  if (event.url.pathname.startsWith("/.well-known/")) {
    return new Response(null, { status: 404 });
  }

  try {
    return await handler(toRequest(event));
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
  return (event: any) => handler(toRequest(event));
}
