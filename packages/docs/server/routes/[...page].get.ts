import {
  createH3SSRHandler,
  DEFAULT_SSR_CACHE_HEADERS,
} from "@agent-native/core/server/ssr-handler";
import { buildMarkdownResponseHeaders } from "../../../core/src/agent-web/index";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  createError,
  getRequestHeader,
  getRequestURL,
  setHeader,
  type H3Event,
} from "h3";

const SITE_URL = "https://www.agent-native.com";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ssrHandler = createH3SSRHandler(
  () => import("virtual:react-router/server-build"),
);

export default async function docsPageHandler(event: H3Event) {
  const agentWebAsset = readAgentWebAssetForRequest(event);
  if (agentWebAsset) {
    setHeader(event, "content-type", agentWebAsset.contentType);
    setDefaultSsrCacheHeaders(event);
    setHeader(event, "link", `<${SITE_URL}/llms.txt>; rel="llms-txt"`);
    return agentWebAsset.content;
  }

  const markdown = readMarkdownForRequest(event);
  if (markdown) {
    for (const [name, value] of Object.entries(
      buildMarkdownResponseHeaders({
        siteUrl: SITE_URL,
        pagePath: markdown.pagePath,
        markdownPath: `/${markdown.relativePath}`,
        markdown: markdown.content,
      }),
    )) {
      setHeader(event, name, value);
    }
    setDefaultSsrCacheHeaders(event);
    return markdown.content;
  }

  if (getRequestURL(event).pathname.endsWith(".md")) {
    throw createError({ statusCode: 404, statusMessage: "Markdown not found" });
  }

  return ssrHandler(event);
}

function setDefaultSsrCacheHeaders(event: H3Event) {
  // Keep docs-only public text/markdown assets on the same framework SSR cache
  // policy as HTML and React Router .data. Do not move these back to
  // netlify.toml: core owns the browser/CDN/Netlify durable header set so every
  // provider and template gets the same short-fresh/long-SWR behavior.
  for (const [name, value] of Object.entries(DEFAULT_SSR_CACHE_HEADERS)) {
    setHeader(event, name, value);
  }
}

function readAgentWebAssetForRequest(
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
  if (!contentType) return undefined;

  const relativePath = pathname.replace(/^\//, "");
  const absolutePath = findPublicFile(relativePath);
  if (!absolutePath) return undefined;

  return {
    content: fs.readFileSync(absolutePath, "utf8"),
    contentType,
  };
}

function readMarkdownForRequest(
  event: H3Event,
): { content: string; pagePath: string; relativePath: string } | undefined {
  const requestUrl = getRequestURL(event);
  const acceptsMarkdown =
    getRequestHeader(event, "accept")?.includes("text/markdown") ?? false;
  const pathname = requestUrl.pathname.replace(/\/+$/, "") || "/";
  const isMarkdownPath = pathname.endsWith(".md");
  if (!isMarkdownPath && !acceptsMarkdown) return undefined;

  const relativePath = markdownRelativePathForRequest(pathname, isMarkdownPath);
  if (!relativePath) return undefined;

  const absolutePath = findPublicFile(relativePath);
  if (!absolutePath) return undefined;

  return {
    content: fs.readFileSync(absolutePath, "utf8"),
    pagePath: pagePathForMarkdownRequest(pathname, relativePath),
    relativePath,
  };
}

function markdownRelativePathForRequest(
  pathname: string,
  isMarkdownPath: boolean,
): string | undefined {
  let relativePath: string;
  if (isMarkdownPath) {
    relativePath = pathname.replace(/^\//, "");
  } else if (pathname === "/") {
    relativePath = "index.md";
  } else if (pathname === "/docs") {
    relativePath = "docs/getting-started.md";
  } else {
    relativePath = `${pathname.replace(/^\//, "")}.md`;
  }

  const normalized = path.posix.normalize(relativePath);
  if (normalized.startsWith("../") || normalized === "..") return undefined;
  return normalized;
}

function pagePathForMarkdownRequest(
  pathname: string,
  relativePath: string,
): string {
  if (!pathname.endsWith(".md")) return pathname;
  if (relativePath === "index.md") return "/";
  if (relativePath === "docs/getting-started.md") return "/docs";
  return `/${relativePath.replace(/\.md$/, "")}`;
}

function findPublicFile(relativePath: string): string | undefined {
  const roots = publicRootCandidates();
  for (const root of roots) {
    const absolutePath = path.resolve(root, relativePath);
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
