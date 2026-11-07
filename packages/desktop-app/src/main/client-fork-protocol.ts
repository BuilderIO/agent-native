import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

import type { ClientForkStatus } from "../../shared/client-forks.js";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

export function clientForkLocalPath(
  request: Request,
  origin: string,
): string | null {
  const base = new URL(origin);
  const url = new URL(request.url);
  if (url.origin !== base.origin || request.method !== "GET") return null;
  const mount = base.pathname.replace(/\/$/, "");
  if (mount && url.pathname !== mount && !url.pathname.startsWith(`${mount}/`))
    return null;
  const relative = url.pathname.slice(mount.length);
  if (
    /^\/(?:_agent-native|api|mcp|oauth|auth|sign-in|sign-out|login|signup|__manifest)(?:\/|$)/.test(
      relative,
    ) ||
    relative.endsWith(".data")
  )
    return null;
  const segments = decodeURIComponent(relative).split("/");
  if (
    segments.some(
      (segment) =>
        segment === ".." || segment.includes("\\") || segment.includes("\0"),
    )
  )
    throw new Error("Invalid local asset path");
  if (relative.startsWith("/assets/"))
    return segments.filter(Boolean).join("/");
  if (
    request.destination === "document" ||
    request.headers.get("sec-fetch-dest") === "document" ||
    (request.headers.get("accept")?.includes("text/html") &&
      !path.posix.extname(relative))
  )
    return "index.html";
  return null;
}

export function createClientForkHandler(options: {
  origin: string;
  status: () => ClientForkStatus;
  forward: (request: Request) => Promise<Response>;
  fail: (error: Error) => void;
}): (request: Request) => Promise<Response> {
  return async (request) => {
    const status = options.status();
    if (!status.enabled || !status.buildPath) return options.forward(request);
    try {
      const relative = clientForkLocalPath(request, options.origin);
      if (!relative) {
        const response = await options.forward(request);
        if (
          new URL(request.url).origin === new URL(options.origin).origin &&
          new URL(request.url).pathname.includes("/_agent-native/actions/") &&
          response.headers.get("x-agent-native-client-mismatch") === "1"
        ) {
          options.fail(
            new Error(
              `Hosted action rejected this client (${response.status}). Return to Original and rebuild.`,
            ),
          );
        }
        return response;
      }
      const root = await realpath(status.buildPath);
      const target = await realpath(path.join(root, relative));
      if (
        !target.startsWith(`${root}${path.sep}`) ||
        !(await stat(target)).isFile()
      )
        throw new Error("Local asset escaped its build directory");
      const bytes = await readFile(target);
      return new Response(bytes, {
        headers: {
          "Content-Type":
            CONTENT_TYPES[path.extname(target)] ?? "application/octet-stream",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (error) {
      options.fail(error instanceof Error ? error : new Error(String(error)));
      return options.forward(request);
    }
  };
}
