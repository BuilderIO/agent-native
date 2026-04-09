/**
 * Shared SSR catch-all route handler for React Router.
 *
 * Works in both Node.js (dev) and web-standard runtimes (Netlify Functions v2,
 * Cloudflare Workers, etc.) by avoiding H3 helpers that depend on event.node.
 */
import { createRequestHandler } from "react-router";
import { defineEventHandler, getRequestURL, toWebRequest } from "h3";

const handler = createRequestHandler(
  // @ts-expect-error — virtual module provided by React Router Vite plugin at build time
  () => import("virtual:react-router/server-build"),
);

/**
 * Get a URL object from an H3 event, compatible with both Node and web runtimes.
 * In web runtimes (Cloudflare Workers, etc.) event.url is populated directly.
 * In Node.js, we fall back to getRequestURL() which reads from event.node.req.
 */
function getUrl(event: any): URL {
  if (event.url) return event.url;
  return getRequestURL(event);
}

/**
 * Convert an H3 event to a web Request, compatible with both Node and web runtimes.
 */
function toRequest(event: any): Request {
  if (event.req instanceof Request) return event.req;
  try {
    return toWebRequest(event);
  } catch {
    // Fallback for runtimes where toWebRequest may fail
    return new Request(getUrl(event).href, {
      method: event.method,
      headers: event.headers,
    });
  }
}

/**
 * Default SSR catch-all handler. Ignores /.well-known/ probes and renders
 * all other routes through React Router.
 */
export const ssrHandler = defineEventHandler(async (event: any) => {
  const p = getUrl(event).pathname;
  if (
    p.startsWith("/.well-known/") ||
    p === "/favicon.ico" ||
    p === "/favicon.png"
  ) {
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
