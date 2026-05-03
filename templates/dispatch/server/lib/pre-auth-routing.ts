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

function isDispatchPagePath(pathname: string): boolean {
  if (DISPATCH_PAGE_PATHS.has(pathname)) return true;
  if (pathname === "/approval" || pathname === "/tools") return true;
  return /^\/tools\/[^/]+$/.test(pathname);
}

function isDispatchAssetOrFrameworkPath(pathname: string): boolean {
  return (
    pathname === "/_agent-native" ||
    pathname.startsWith("/_agent-native/") ||
    pathname === "/.well-known" ||
    pathname.startsWith("/.well-known/") ||
    pathname.startsWith("/assets/") ||
    pathname.startsWith("/_build/") ||
    pathname.endsWith(".js") ||
    pathname.endsWith(".css") ||
    pathname.endsWith(".map") ||
    pathname.endsWith(".ico") ||
    pathname.endsWith(".png") ||
    pathname.endsWith(".svg") ||
    pathname.endsWith(".woff2") ||
    pathname.endsWith(".woff")
  );
}

function dispatchNotFoundResponse(): Response {
  return new Response("Dispatch route not found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export function rootDispatchRedirect(
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
    const dispatchPath = pathname.slice(basePath.length);
    if (
      isDispatchPagePath(dispatchPath) ||
      isDispatchAssetOrFrameworkPath(dispatchPath)
    ) {
      return null;
    }
    return dispatchNotFoundResponse();
  }

  if (DISPATCH_PAGE_PATHS.has(pathname)) {
    return new Response(null, {
      status: 302,
      headers: { Location: `${basePath}${pathname}${search}` },
    });
  }

  return dispatchNotFoundResponse();
}
