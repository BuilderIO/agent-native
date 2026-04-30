import { getSession } from "@agent-native/core/server";
import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { defineEventHandler } from "h3";
import { createRequestHandler } from "react-router";

const handler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
);

const ASSET_EXTENSIONS = new Set([
  "avif",
  "css",
  "gif",
  "ico",
  "jpeg",
  "jpg",
  "js",
  "json",
  "map",
  "png",
  "svg",
  "txt",
  "webmanifest",
  "webp",
  "woff",
  "woff2",
]);

function isAssetPath(pathname: string): boolean {
  if (pathname.endsWith(".data")) return false;
  const lastSegment = pathname.split("/").pop() ?? "";
  const extension = lastSegment.split(".").pop()?.toLowerCase();
  return extension ? ASSET_EXTENSIONS.has(extension) : false;
}

export default defineEventHandler(async (event) => {
  const p = event.url.pathname;
  if (
    p.startsWith("/.well-known/") ||
    p.startsWith("/_agent-native/") ||
    p.startsWith("/api/") ||
    p === "/favicon.ico" ||
    p === "/favicon.png" ||
    isAssetPath(p)
  ) {
    return new Response(null, { status: 404 });
  }

  const session = await getSession(event).catch(() => null);
  return runWithRequestContext(
    {
      userEmail: session?.email,
      orgId: session?.orgId,
    },
    async () => handler(event.req as Request),
  );
});
