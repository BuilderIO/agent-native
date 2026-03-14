import { type RequestHandler } from "express";
import { requireEnvKey } from "@agent-native/core/server";
import {
  getContentCalendar,
  getContentCalendarSchema,
  getNotionPage,
} from "../lib/notion";

// GET /api/notion/content-calendar — returns all content calendar entries
export const handleContentCalendar: RequestHandler = async (_req, res) => {
  if (requireEnvKey(res, "NOTION_API_KEY", "Notion")) return;
  try {
    const entries = await getContentCalendar();
    res.json({ entries, total: entries.length });
  } catch (err: any) {
    console.error("Notion content-calendar error:", err.message);
    res.status(500).json({ error: err.message });
  }
};

// GET /api/notion/content-calendar/schema — returns the database schema
export const handleContentCalendarSchema: RequestHandler = async (
  _req,
  res,
) => {
  if (requireEnvKey(res, "NOTION_API_KEY", "Notion")) return;
  try {
    const schema = await getContentCalendarSchema();
    res.json({ schema });
  } catch (err: any) {
    console.error("Notion schema error:", err.message);
    res.status(500).json({ error: err.message });
  }
};

// GET /api/notion/page/:pageId — returns page title and blocks for rendering
export const handleNotionPage: RequestHandler = async (req, res) => {
  if (requireEnvKey(res, "NOTION_API_KEY", "Notion")) return;
  try {
    const pageId = req.params.pageId as string;
    if (!pageId) {
      res.status(400).json({ error: "pageId is required" });
      return;
    }
    const data = await getNotionPage(pageId);
    res.json(data);
  } catch (err: any) {
    console.error("Notion page error:", err.message);
    res.status(500).json({ error: err.message });
  }
};
