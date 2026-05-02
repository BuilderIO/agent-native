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
  const metaEnv = (
    import.meta as unknown as {
      env?: Record<string, string | undefined>;
    }
  ).env;
  return normalizeAppBasePath(
    process.env.VITE_APP_BASE_PATH ||
      process.env.APP_BASE_PATH ||
      metaEnv?.VITE_APP_BASE_PATH ||
      metaEnv?.APP_BASE_PATH ||
      metaEnv?.BASE_URL,
  );
}

function stripAppBasePath(pathname: string): string {
  const basePath = getAppBasePath();
  return stripBasePath(pathname, basePath);
}

function stripBasePath(pathname: string, basePath: string): string {
  if (!basePath) return pathname;
  if (pathname === basePath) return "/";
  if (pathname.startsWith(`${basePath}/`)) {
    return pathname.slice(basePath.length) || "/";
  }
  return pathname;
}

function requestWithPathname(
  request: Request,
  pathname: string,
  basePath: string,
): Request {
  const url = new URL(request.url);
  let changed = false;
  if (basePath && pathname === "/__manifest") {
    const paths = url.searchParams.get("paths");
    if (paths) {
      const strippedPaths = paths
        .split(",")
        .map((path) => stripBasePath(path, basePath))
        .join(",");
      if (strippedPaths !== paths) {
        url.searchParams.set("paths", strippedPaths);
        changed = true;
      }
    }
  }
  if (url.pathname !== pathname) {
    url.pathname = pathname;
    changed = true;
  }
  if (!changed) return request;
  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers: request.headers,
    signal: request.signal,
  };
  if (request.body && !["GET", "HEAD"].includes(request.method.toUpperCase())) {
    init.body = request.body;
    init.duplex = "half";
  }
  return new Request(url, init);
}

function prefixMountedPath(path: string, basePath: string): string {
  if (!basePath || !path.startsWith("/") || path.startsWith("//")) return path;
  if (path === basePath || path.startsWith(`${basePath}/`)) return path;
  return `${basePath}${path}`;
}

function prefixMountedHtml(html: string, basePath: string): string {
  if (!basePath) return html;
  return html
    .replace(
      /\b(href|src|action|formaction|poster)=(["'])(\/(?!\/)[^"']*)\2/g,
      (_match, attr: string, quote: string, path: string) =>
        `${attr}=${quote}${prefixMountedPath(path, basePath)}${quote}`,
    )
    .replace(/url\((["']?)(\/(?!\/)[^)'" ]+)\1\)/g, (_match, quote, path) => {
      const q = quote || "";
      return `url(${q}${prefixMountedPath(path, basePath)}${q})`;
    });
}

async function rewriteMountedResponse(
  response: Response,
  basePath: string,
): Promise<Response> {
  if (!basePath) return response;

  const headers = new Headers(response.headers);
  const location = headers.get("location");
  if (location?.startsWith("/") && !location.startsWith("//")) {
    headers.set("location", prefixMountedPath(location, basePath));
  }

  const contentType = headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("text/html") || !response.body) {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  const html = await response.text();
  headers.delete("content-length");
  return new Response(prefixMountedHtml(html, basePath), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Create an h3 catch-all that hands page routes to React Router and
 * returns 404 for framework / asset paths that React Router doesn't own.
 */
export function createH3SSRHandler(getBuild: () => Promise<unknown> | unknown) {
  const handler = createRequestHandler(getBuild as any);
  return defineEventHandler(async (event) => {
    const basePath = getAppBasePath();
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
      const request = requestWithPathname(event.req as Request, p, basePath);
      if (request.method === "HEAD") {
        const getRequest = new Request(request.url, {
          method: "GET",
          headers: request.headers,
          signal: request.signal,
        });
        const response = await handler(getRequest);
        return await rewriteMountedResponse(
          new Response(null, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          }),
          basePath,
        );
      }
      return await rewriteMountedResponse(await handler(request), basePath);
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
