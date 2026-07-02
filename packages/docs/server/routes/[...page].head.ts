import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  createH3SSRHandler,
  DEFAULT_SSR_CACHE_HEADERS,
} from "@agent-native/core/server/ssr-handler";
import { getRequestURL, setHeader, type H3Event } from "h3";

import { estimateMarkdownTokens } from "../../../core/src/agent-web/index";

const SITE_URL = "https://www.agent-native.com";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ssrHandler = createH3SSRHandler(
  () => import("virtual:react-router/server-build"),
);

export default async function docsHeadHandler(event: H3Event) {
  const asset = readHeadAssetForRequest(event);
  if (asset) {
    setHeader(event, "content-type", asset.contentType);
    setHeader(
      event,
      "content-length",
      String(Buffer.byteLength(asset.content)),
    );
    setDefaultSsrCacheHeaders(event);
    setHeader(event, "link", `<${SITE_URL}/llms.txt>; rel="llms-txt"`);
    if (asset.contentType.startsWith("text/markdown")) {
      setHeader(
        event,
        "x-markdown-tokens",
        String(estimateMarkdownTokens(asset.content)),
      );
    }
    return "";
  }

  return ssrHandler(event);
}

function setDefaultSsrCacheHeaders(event: H3Event) {
  // HEAD mirrors the GET cache policy exactly. Keep this tied to the framework
  // header object instead of app-level provider config so public docs deploys
  // keep CDN SWR and Netlify durable caching without local header blocks.
  for (const [name, value] of Object.entries(DEFAULT_SSR_CACHE_HEADERS)) {
    setHeader(event, name, value);
  }
}

function readHeadAssetForRequest(
  event: H3Event,
): { content: string; contentType: string } | undefined {
  const pathname = getRequestURL(event).pathname.replace(/\/+$/, "") || "/";
  const contentTypeByPath: Record<string, string> = {
    "/llms.txt": "text/plain; charset=utf-8",
    "/llms-full.txt": "text/plain; charset=utf-8",
    "/robots.txt": "text/plain; charset=utf-8",
    "/sitemap.xml": "application/xml; charset=utf-8",
  };
  const contentType = contentTypeByPath[pathname];
  const relativePath = pathname.endsWith(".md")
    ? pathname.replace(/^\//, "")
    : contentType
      ? pathname.replace(/^\//, "")
      : undefined;
  if (!relativePath) return undefined;

  const absolutePath = findPublicFile(relativePath);
  if (!absolutePath) return undefined;

  return {
    content: fs.readFileSync(absolutePath, "utf8"),
    contentType: contentType ?? "text/markdown; charset=utf-8",
  };
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
