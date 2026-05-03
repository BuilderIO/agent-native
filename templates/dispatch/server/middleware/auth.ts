/**
 * Global auth middleware — runs for ALL requests (page routes, API routes,
 * framework routes). The auth plugin configures the guard; this middleware
 * enforces it on every request.
 *
 * Without this, auth only runs for /_agent-native/* routes because the
 * framework handler's middleware registry is scoped to that catch-all.
 * Page routes (/, /settings) and API routes (/api/*) would bypass auth.
 */
import { defineEventHandler } from "h3";
import { runAuthGuard } from "@agent-native/core/server";

function normalizeBasePath(value?: string): string {
  if (!value || value === "/") return "";
  const trimmed = value.trim();
  if (!trimmed || trimmed === "/") return "";
  return `/${trimmed.replace(/^\/+/, "").replace(/\/+$/, "")}`;
}

const DISPATCH_PAGE_PATHS = new Set([
  "/overview",
  "/login",
  "/signup",
  "/apps",
  "/new-app",
  "/vault",
  "/integrations",
  "/agents",
  "/workspace",
  "/messaging",
  "/destinations",
  "/identities",
  "/approvals",
  "/audit",
  "/team",
]);

function rootDispatchRedirect(
  pathname: string,
  search: string,
): Response | null {
  const basePath = normalizeBasePath(
    process.env.VITE_APP_BASE_PATH || process.env.APP_BASE_PATH,
  );
  if (!basePath) return null;

  if (pathname === "/_agent-native" || pathname.startsWith("/_agent-native/")) {
    return null;
  }

  if (pathname === "/.well-known" || pathname.startsWith("/.well-known/")) {
    return null;
  }

  if (pathname === "/") {
    return new Response(null, {
      status: 302,
      headers: { Location: `${basePath}/overview${search}` },
    });
  }

  if (pathname === basePath) {
    return new Response(null, {
      status: 302,
      headers: { Location: `${basePath}/overview${search}` },
    });
  }

  if (pathname === `${basePath}/`) {
    return new Response(null, {
      status: 302,
      headers: { Location: `${basePath}/overview${search}` },
    });
  }

  if (pathname.startsWith(`${basePath}/`)) {
    return null;
  }

  if (DISPATCH_PAGE_PATHS.has(pathname)) {
    return new Response(null, {
      status: 302,
      headers: { Location: `${basePath}${pathname}${search}` },
    });
  }

  return new Response("Reserved for workspace app routes", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export default defineEventHandler(async (event) => {
  const redirectOrReserved = rootDispatchRedirect(
    event.url.pathname,
    event.url.search,
  );
  if (redirectOrReserved) return redirectOrReserved;

  return runAuthGuard(event);
});
