import { type RequestHandler } from "express";
import { requireEnvKey } from "@agent-native/core/server";
import {
  getAllBlogPagesSeo,
  getRankedKeywordsForPage,
  getAllTopBlogKeywords,
} from "../lib/dataforseo";

// GET /api/seo/blog-pages — returns SEO data for all blog pages
export const handleBlogPagesSeo: RequestHandler = async (_req, res) => {
  if (requireEnvKey(res, "DATAFORSEO_LOGIN", "DataForSEO")) return;
  try {
    const pages = await getAllBlogPagesSeo();
    res.json({ pages, total: Object.keys(pages).length });
  } catch (err: any) {
    console.error("DataForSEO blog-pages error:", err.message);
    res.status(500).json({ error: err.message });
  }
};

// GET /api/seo/top-keywords?limit=500 — returns top ranked blog keywords with rank changes
export const handleTopKeywords: RequestHandler = async (req, res) => {
  if (requireEnvKey(res, "DATAFORSEO_LOGIN", "DataForSEO")) return;
  try {
    const limit = Math.min(Number(req.query.limit) || 500, 1000);
    const keywords = await getAllTopBlogKeywords(limit);
    res.json({ keywords, total: keywords.length });
  } catch (err: any) {
    console.error("DataForSEO top-keywords error:", err.message);
    res.status(500).json({ error: err.message });
  }
};

// GET /api/seo/keywords?slug=some-slug — returns top keywords for a blog page
export const handlePageKeywords: RequestHandler = async (req, res) => {
  if (requireEnvKey(res, "DATAFORSEO_LOGIN", "DataForSEO")) return;
  const slug = req.query.slug as string;
  if (!slug) {
    res.status(400).json({ error: "Missing ?slug= parameter" });
    return;
  }

  try {
    const keywords = await getRankedKeywordsForPage(slug, 20);
    res.json({ keywords });
  } catch (err: any) {
    console.error("DataForSEO keywords error:", err.message);
    res.status(500).json({ error: err.message });
  }
};
