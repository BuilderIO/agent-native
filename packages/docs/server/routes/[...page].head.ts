import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  createH3SSRHandler,
  resolveSsrCacheHeaders,
  resolveSsrCacheKeyHeaders,
} from "@agent-native/core/server/ssr-handler";
import {
  createError,
  getRequestHeader,
  getRequestURL,
  setHeader,
  type H3Event,
} from "h3";

import { estimateMarkdownTokens } from "../../../core/src/agent-web/index";
import { applyDocsSsrCacheKeyHeaders } from "../../lib/ssr-cache";
import { acceptsMarkdown, appendVary } from "../lib/agent-web-responses";
import { fetchMarkdownMirror } from "../lib/markdown-mirror";

const SITE_URL = "https://www.agent-native.com";
const MARKDOWN_REWRITE_PREFIX = "/__agent-native-markdown";
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
      setHeader(event, "vary", "Accept, Accept-Encoding");
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
  appendVary(headers, ["Accept", "Accept-Encoding"]);
  // Preserve the stronger full-query key emitted by core for query-preserving
  // redirects; the normal Docs key is only for ordinary public SSR pages.
  applyDocsSsrCacheKeyHeaders(headers);
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
  const pathname = markdownRequestPath(event).replace(/\/+$/, "") || "/";
  const wantsMarkdown = acceptsMarkdown(getRequestHeader(event, "accept"));
  const contentTypeByPath: Record<string, string> = {
    "/llms.txt": "text/plain; charset=utf-8",
    "/llms-full.txt": "text/plain; charset=utf-8",
    "/robots.txt": "text/plain; charset=utf-8",
    "/sitemap.xml": "application/xml; charset=utf-8",
    "/openapi.json": "application/json; charset=utf-8",
  };
  const contentType = contentTypeByPath[pathname];
  const isMarkdownPath = pathname.endsWith(".md");
  const relativePath = isMarkdownPath
    ? pathname.replace(/^\//, "")
    : contentType
      ? pathname.replace(/^\//, "")
      : wantsMarkdown
        ? markdownRelativePathForRequest(pathname)
        : undefined;
  if (!relativePath) return undefined;

  const isMarkdown = isMarkdownPath || wantsMarkdown;
  const content = isMarkdown
    ? await readMarkdownContent(relativePath, event)
    : readLocalFile(relativePath);
  if (content === undefined) return undefined;

  return {
    content,
    contentType: contentType ?? "text/markdown; charset=utf-8",
  };
}

function markdownRequestPath(event: H3Event): string {
  const pathname = getRequestURL(event).pathname;
  if (pathname === MARKDOWN_REWRITE_PREFIX) return "/";
  if (pathname.startsWith(`${MARKDOWN_REWRITE_PREFIX}/`)) {
    return pathname.slice(MARKDOWN_REWRITE_PREFIX.length) || "/";
  }
  return pathname;
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

  const mirror = await fetchMarkdownMirror(relativePath, event);
  if (mirror.kind === "found") return mirror.content;
  if (mirror.kind === "absent") return undefined;
  throw createError({ statusCode: 502, statusMessage: mirror.reason });
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
