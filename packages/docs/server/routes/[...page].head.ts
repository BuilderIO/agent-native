import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  createH3SSRHandler,
  resolveSsrCacheHeaders,
  resolveSsrCacheKeyHeaders,
} from "@agent-native/core/server/ssr-handler";
import { getRequestHeader, getRequestURL, setHeader, type H3Event } from "h3";

import { estimateMarkdownTokens } from "../../../core/src/agent-web/index";

const SITE_URL = "https://www.agent-native.com";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ssrHandler = createH3SSRHandler(
  () => import("virtual:react-router/server-build"),
);

export default async function docsHeadHandler(event: H3Event) {
  const asset = await readHeadAssetForRequest(event);
  if (asset) {
    setHeader(event, "content-type", asset.contentType);
    setHeader(
      event,
      "content-length",
      String(Buffer.byteLength(asset.content)),
    );
    setSsrCacheHeaders(event);
    setHeader(event, "link", `<${SITE_URL}/llms.txt>; rel="llms-txt"`);
    if (asset.contentType.startsWith("text/markdown")) {
      setHeader(event, "vary", "Accept");
      setHeader(
        event,
        "x-markdown-tokens",
        String(estimateMarkdownTokens(asset.content)),
      );
    }
    return "";
  }

  const response = await ssrHandler(event);
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(resolveSsrCacheKeyHeaders())) {
    headers.set(k, v);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function setSsrCacheHeaders(event: H3Event) {
  // HEAD mirrors the GET cache policy exactly. Keep this tied to the framework
  // resolver instead of app-level provider config so public docs deploys keep
  // CDN SWR and Netlify durable caching without local header blocks.
  for (const [name, value] of Object.entries(resolveSsrCacheHeaders())) {
    setHeader(event, name, value);
  }
  for (const [k, v] of Object.entries(resolveSsrCacheKeyHeaders())) {
    setHeader(event, k, v);
  }
}

async function readHeadAssetForRequest(
  event: H3Event,
): Promise<{ content: string; contentType: string } | undefined> {
  const pathname = getRequestURL(event).pathname.replace(/\/+$/, "") || "/";
  const acceptsMarkdown =
    getRequestHeader(event, "accept")?.includes("text/markdown") ?? false;
  const contentTypeByPath: Record<string, string> = {
    "/llms.txt": "text/plain; charset=utf-8",
    "/llms-full.txt": "text/plain; charset=utf-8",
    "/robots.txt": "text/plain; charset=utf-8",
    "/sitemap.xml": "application/xml; charset=utf-8",
  };
  const contentType = contentTypeByPath[pathname];
  const isMarkdownPath = pathname.endsWith(".md");
  const relativePath = isMarkdownPath
    ? pathname.replace(/^\//, "")
    : contentType
      ? pathname.replace(/^\//, "")
      : acceptsMarkdown
        ? markdownRelativePathForRequest(pathname)
        : undefined;
  if (!relativePath) return undefined;

  const isMarkdown = isMarkdownPath || acceptsMarkdown;
  const content = isMarkdown
    ? await readMarkdownContent(relativePath, event)
    : readLocalFile(relativePath);
  if (content === undefined) return undefined;

  return {
    content,
    contentType: contentType ?? "text/markdown; charset=utf-8",
  };
}

function markdownRelativePathForRequest(pathname: string): string {
  if (pathname === "/") return "index.md";
  if (pathname === "/docs") return "docs/getting-started.md";
  return `${pathname.replace(/^\//, "")}.md`;
}

async function readMarkdownContent(
  relativePath: string,
  event: H3Event,
): Promise<string | undefined> {
  const localContent = readLocalFile(relativePath);
  if (localContent !== undefined) return localContent;

  // Netlify publishes markdown mirrors as static files, but does not mount the
  // publish directory beside every serverless function. Read the same mirror
  // when the function bundle cannot see the local build output.
  const staticUrl = new URL(`/${relativePath}`, getRequestURL(event));
  const response = await fetch(staticUrl, {
    headers: { accept: "text/markdown" },
  });
  if (!response.ok) return undefined;
  const responseContentType =
    response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!responseContentType.includes("text/markdown")) return undefined;
  return response.text();
}

function readLocalFile(relativePath: string): string | undefined {
  const absolutePath = findPublicFile(relativePath);
  return absolutePath ? fs.readFileSync(absolutePath, "utf8") : undefined;
}

function findPublicFile(relativePath: string): string | undefined {
  const normalized = path.posix.normalize(relativePath);
  if (normalized.startsWith("../") || normalized === "..") return undefined;

  for (const root of publicRootCandidates()) {
    const absolutePath = path.resolve(root, normalized);
    if (!absolutePath.startsWith(`${root}${path.sep}`)) continue;
    if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile()) {
      return absolutePath;
    }
  }
  return undefined;
}

function publicRootCandidates(): string[] {
  const roots = new Set<string>();
  const cwd = process.cwd();
  for (const suffix of [
    ".output/public",
    "build/client",
    "dist/client",
    "dist",
    "public",
  ]) {
    roots.add(path.resolve(cwd, suffix));
  }

  let cursor = __dirname;
  for (let i = 0; i < 8; i++) {
    for (const suffix of [".output/public", "public", "dist", "build/client"]) {
      roots.add(path.resolve(cursor, suffix));
    }
    const next = path.dirname(cursor);
    if (next === cursor) break;
    cursor = next;
  }

  return Array.from(roots);
}
