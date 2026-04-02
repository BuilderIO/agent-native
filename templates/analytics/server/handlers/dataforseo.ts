import { defineEventHandler, getQuery, setResponseStatus } from "h3";
import { requireCredential } from "../lib/credentials";
import {
  getAllBlogPagesSeo,
  getRankedKeywordsForPage,
  getAllTopBlogKeywords,
} from "../lib/dataforseo";

// GET /api/seo/blog-pages — returns SEO data for all blog pages
export const handleBlogPagesSeo = defineEventHandler(async (event) => {
  const missing = await requireCredential(
    event,
    "DATAFORSEO_LOGIN",
    "DataForSEO",
  );
  if (missing) return missing;
  try {
    const pages = await getAllBlogPagesSeo();
    return { pages, total: Object.keys(pages).length };
  } catch (err: any) {
    console.error("DataForSEO blog-pages error:", err.message);
    setResponseStatus(event, 500);
    return { error: err.message };
  }
});

// GET /api/seo/top-keywords?limit=500 — returns top ranked blog keywords with rank changes
export const handleTopKeywords = defineEventHandler(async (event) => {
  const missing = await requireCredential(
    event,
    "DATAFORSEO_LOGIN",
    "DataForSEO",
  );
  if (missing) return missing;
  try {
    const { limit: limitParam } = getQuery(event);
    const limit = Math.min(Number(limitParam) || 500, 1000);
    const keywords = await getAllTopBlogKeywords(limit);
    return { keywords, total: keywords.length };
  } catch (err: any) {
    console.error("DataForSEO top-keywords error:", err.message);
    setResponseStatus(event, 500);
    return { error: err.message };
  }
});

// GET /api/seo/keywords?slug=some-slug — returns top keywords for a blog page
export const handlePageKeywords = defineEventHandler(async (event) => {
  const missing = await requireCredential(
    event,
    "DATAFORSEO_LOGIN",
    "DataForSEO",
  );
  if (missing) return missing;
  const { slug } = getQuery(event);
  if (!slug) {
    setResponseStatus(event, 400);
    return { error: "Missing ?slug= parameter" };
  }

  try {
    const keywords = await getRankedKeywordsForPage(slug as string, 20);
    return { keywords };
  } catch (err: any) {
    console.error("DataForSEO keywords error:", err.message);
    setResponseStatus(event, 500);
    return { error: err.message };
  }
});
