/**
 * Shared SSR catch-all handler for React Router framework mode.
 *
 * Templates wire this up via:
 *
 *   // server/routes/[...page].get.ts
 *   import { createH3SSRHandler } from "@agent-native/core/server/ssr-handler";
 *   export default createH3SSRHandler(
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

function normalizeAppBasePath(value: string | undefined): string {
  if (!value || value === "/") return "";
  const trimmed = value.trim();
  if (!trimmed || trimmed === "/") return "";
  return `/${trimmed.replace(/^\/+/, "").replace(/\/+$/, "")}`;
}

function getAppBasePath(): string {
  return normalizeAppBasePath(
    process.env.VITE_APP_BASE_PATH || process.env.APP_BASE_PATH,
  );
}

function stripAppBasePath(pathname: string): string {
  const basePath = getAppBasePath();
  if (!basePath) return pathname;
  if (pathname === basePath) return "/";
  if (pathname.startsWith(`${basePath}/`)) {
    return pathname.slice(basePath.length) || "/";
  }
  return pathname;
}

function requestWithPathname(request: Request, pathname: string): Request {
  const url = new URL(request.url);
  if (url.pathname === pathname) return request;
  url.pathname = pathname;
  return new Request(url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    signal: request.signal,
    duplex: "half",
  } as RequestInit);
}

/**
 * Create an h3 catch-all that hands page routes to React Router and
 * returns 404 for framework / asset paths that React Router doesn't own.
 */
export function createH3SSRHandler(getBuild: () => Promise<unknown> | unknown) {
  const handler = createRequestHandler(getBuild as any);
  return defineEventHandler(async (event) => {
    const p = stripAppBasePath(event.url.pathname);
    if (
      p.startsWith("/.well-known/") ||
      p.startsWith("/_agent-native/") ||
      p.startsWith("/api/") ||
      p === "/favicon.ico" ||
      p === "/favicon.png" ||
      (/\.\w+$/.test(p) && !p.endsWith(".data"))
    ) {
      return new Response(null, { status: 404 });
    }
    try {
      const request = requestWithPathname(event.req as Request, p);
      if (request.method === "HEAD") {
        const getRequest = new Request(request.url, {
          method: "GET",
          headers: request.headers,
          signal: request.signal,
        });
        const response = await handler(getRequest);
        return new Response(null, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      }
      return await handler(request);
    } catch (err) {
      // Log the full stack server-side, but never leak it to the client.
      // Stack traces expose file paths, library versions, and code structure
      // that aid reconnaissance attacks. In dev we surface the message text
      // so devtools shows something useful; in prod we return a bare 500.
      console.error("[ssr-handler] SSR error:", err);
      const isProd = process.env.NODE_ENV === "production";
      const body = isProd
        ? "Internal Server Error"
        : `Internal Server Error: ${(err as Error)?.message ?? err}`;
      return new Response(body, {
        status: 500,
        headers: { "content-type": "text/plain" },
      });
    }
  });
}
