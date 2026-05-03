
// Auto-generated worker entry point for node
import { H3, defineEventHandler, readBody, toResponse } from "h3";
import { createRequestHandler } from "react-router";
import * as serverBuild from "./server-build.js";

function normalizeAppBasePath(value) {
  if (!value || value === "/") return "";
  const trimmed = String(value).trim();
  if (!trimmed || trimmed === "/") return "";
  return "/" + trimmed.replace(/^\/+/, "").replace(/\/+$/, "");
}

function getAppBasePath() {
  return normalizeAppBasePath(
    globalThis.process?.env?.VITE_APP_BASE_PATH ||
      globalThis.process?.env?.APP_BASE_PATH,
  );
}

function stripAppBasePath(pathname) {
  const basePath = getAppBasePath();
  if (!basePath) return pathname;
  if (pathname === basePath) return "/";
  if (pathname.startsWith(basePath + "/")) {
    return pathname.slice(basePath.length) || "/";
  }
  return pathname;
}

function isApiPath(pathname) {
  return pathname === "/api" || pathname.startsWith("/api/");
}

function isFrameworkPath(pathname) {
  return (
    pathname === "/_agent-native" || pathname.startsWith("/_agent-native/")
  );
}

function requestWithMountedApiPrefixStripped(request) {
  const basePath = getAppBasePath();
  if (!basePath) return request;
  const url = new URL(request.url);
  const strippedPathname = stripAppBasePath(url.pathname);
  if (strippedPathname === url.pathname) {
    return request;
  }
  if (!isApiPath(strippedPathname) && !isFrameworkPath(strippedPathname)) {
    return request;
  }
  url.pathname = strippedPathname;
  return new Request(url, request);
}

function prefixMountedPath(path, basePath) {
  if (!basePath || !path.startsWith("/") || path.startsWith("//")) return path;
  if (path === basePath || path.startsWith(basePath + "/")) return path;
  return basePath + path;
}

function prefixMountedHtml(html, basePath) {
  if (!basePath) return html;
  return html
    .replace(
      /\b(href|src|action|formaction|poster)=(["'])(\/(?!\/)[^"']*)\2/g,
      (_match, attr, quote, path) =>
        attr + "=" + quote + prefixMountedPath(path, basePath) + quote,
    )
    .replace(/url\((["']?)(\/(?!\/)[^)'" ]+)\1\)/g, (_match, quote, path) => {
      const q = quote || "";
      return "url(" + q + prefixMountedPath(path, basePath) + q + ")";
    });
}

async function rewriteMountedResponse(response, basePath) {
  if (!basePath) return response;

  const headers = new Headers(response.headers);
  const location = headers.get("location");
  if (location?.startsWith("/") && !location.startsWith("//")) {
    headers.set("location", prefixMountedPath(location, basePath));
  }

  const contentType = headers.get("content-type") || "";
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

function requestWithMethod(request, method) {
  return new Request(request.url, {
    method,
    headers: request.headers,
    signal: request.signal,
  });
}

function requestWithPathname(request, pathname) {
  const url = new URL(request.url);
  if (url.pathname === pathname) return request;
  url.pathname = pathname;
  return new Request(url, request);
}

// API route handlers
import route_0 from "/Users/steve/Projects/builder/agent-native/framework/packages/core/.tmp-worker-test-j2oOle/index.get.mjs";

// Action handlers (auto-discovered from actions/)


// Server plugins


let _handler;

async function getHandler() {
  if (_handler) return _handler;

  const app = new H3();

  // Build a fake nitroApp surface so framework plugins (which expect
  // `nitroApp.h3["~middleware"]`) can register routes via getH3App().
  const noop = () => {};
  const nitroApp = {
    h3: app,
    hooks: { hook: noop, callHook: noop, hookOnce: noop },
    captureError: noop,
  };

  // CORS — applied as global middleware via .use(handler)
  app.use(defineEventHandler((event) => {
    if (event.req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Requested-With,X-Request-Source",
        },
      });
    }
  }));

  // Run plugins — they call getH3App(nitroApp).use(path, handler) which
  // pushes path-prefix middleware onto app["~middleware"].


  // Register API routes
  app.on("GET", "/api", route_0);
  app.on("HEAD", "/api", defineEventHandler(async (event) => {
    const originalReq = event.req;
    event.req = requestWithMethod(event.req, "GET");
    try {
      const result = await route_0(event);
      const response = result instanceof Response ? result : toResponse(result, event);
      return new Response(null, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } finally {
      event.req = originalReq;
    }
  }));

  // Register action routes (/_agent-native/actions/*)


  // SSR catch-all for React Router
  const rrHandler = createRequestHandler(() => serverBuild);
  app.all("/**", defineEventHandler(async (event) => {
    const basePath = getAppBasePath();
    const p = stripAppBasePath(new URL(event.req.url).pathname);
    if (
      p.startsWith("/.well-known/") ||
      p.startsWith("/_agent-native/") ||
      isApiPath(p) ||
      p === "/favicon.ico" ||
      p === "/favicon.png" ||
      (/\.\w+$/.test(p) && !p.endsWith(".data"))
    ) {
      return new Response(null, { status: 404 });
    }
    const request = requestWithPathname(event.req, p);
    if (event.req.method === "HEAD") {
      const getRequest = requestWithMethod(request, "GET");
      const response = await rrHandler(getRequest);
      return rewriteMountedResponse(
        new Response(null, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        }),
        basePath,
      );
    }
    return rewriteMountedResponse(await rrHandler(request), basePath);
  }));

  _handler = app.fetch.bind(app);
  return _handler;
}

export default {
  async fetch(request, env, ctx) {
    // Expose env and ctx bindings globally for compatibility
    if (ctx) globalThis.__cf_ctx = ctx;
    if (env) {
      globalThis.process = globalThis.process || { env: {} };
      globalThis.process.env = globalThis.process.env || {};
      // Expose D1/KV/R2 bindings on globalThis.__cf_env for the db layer
      globalThis.__cf_env = env;
      for (const [key, value] of Object.entries(env)) {
        if (typeof value === "string") {
          globalThis.process.env[key] = value;
        }
      }
    }

    // Try serving static assets first (CF Pages advanced mode).
    // Only attempt this for GET/HEAD — the ASSETS binding is a static file
    // server and returns 405 for any other method, which would short-circuit
    // API calls (PUT/POST/DELETE to /_agent-native/*) before they reach our
    // h3 middleware.
    if (env?.ASSETS && (request.method === "GET" || request.method === "HEAD")) {
      try {
        const assetResponse = await env.ASSETS.fetch(request);
        if (assetResponse.status !== 404) {
          return assetResponse;
        }
      } catch {
        // Asset fetch failed — fall through to SSR
      }
    }

    const handler = await getHandler();
    return handler(requestWithMountedApiPrefixStripped(request));
  }
};
