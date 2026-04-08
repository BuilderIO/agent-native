/**
 * Catch-all route for /docs/* requests.
 * Serves raw markdown for .md requests, SSR for everything else.
 *
 * Example: GET /docs/actions.md → raw markdown for the Actions page
 *          GET /docs/actions    → SSR rendered page
 */
import { createSSRRequestHandler } from "@agent-native/core/server/ssr-handler";
import { defineEventHandler, getRouterParam, setResponseHeader } from "h3";
import fs from "node:fs";
import path from "node:path";

const renderSSR = createSSRRequestHandler();

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, "slug");
  if (!slug || !slug.endsWith(".md")) {
    return renderSSR(event);
  }

  const docSlug = slug.replace(/\.md$/, "");
  const contentDir = path.resolve(import.meta.dirname, "../../../content");
  const filePath = path.join(contentDir, `${docSlug}.md`);

  if (!filePath.startsWith(contentDir) || !fs.existsSync(filePath)) {
    return renderSSR(event);
  }

  const content = fs.readFileSync(filePath, "utf-8");
  setResponseHeader(event, "Content-Type", "text/markdown; charset=utf-8");
  setResponseHeader(event, "Access-Control-Allow-Origin", "*");
  return content;
});
