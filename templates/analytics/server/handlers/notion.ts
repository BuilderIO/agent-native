import { defineEventHandler, getRouterParam, setResponseStatus } from "h3";
import { requireCredential, runApiHandlerWithContext } from "../lib/credentials";
import {
  getContentCalendar,
  getContentCalendarSchema,
  getNotionPage,
} from "../lib/notion";

// GET /api/notion/content-calendar — returns all content calendar entries
export const handleContentCalendar = defineEventHandler(async (event) => {
  return runApiHandlerWithContext(event, async () => {
    const missing = await requireCredential(event, "NOTION_API_KEY", "Notion");
    if (missing) return missing;
    try {
      const entries = await getContentCalendar();
      return { entries, total: entries.length };
    } catch (err: any) {
      console.error("Notion content-calendar error:", err.message);
      setResponseStatus(event, 500);
      return { error: err.message };
    }
  });
});

// GET /api/notion/content-calendar/schema — returns the database schema
export const handleContentCalendarSchema = defineEventHandler(async (event) => {
  return runApiHandlerWithContext(event, async () => {
    const missing = await requireCredential(event, "NOTION_API_KEY", "Notion");
    if (missing) return missing;
    try {
      const schema = await getContentCalendarSchema();
      return { schema };
    } catch (err: any) {
      console.error("Notion schema error:", err.message);
      setResponseStatus(event, 500);
      return { error: err.message };
    }
  });
});

// GET /api/notion/page/:pageId — returns page title and blocks for rendering
export const handleNotionPage = defineEventHandler(async (event) => {
  return runApiHandlerWithContext(event, async () => {
    const missing = await requireCredential(event, "NOTION_API_KEY", "Notion");
    if (missing) return missing;
    try {
      const pageId = getRouterParam(event, "pageId");
      if (!pageId) {
        setResponseStatus(event, 400);
        return { error: "pageId is required" };
      }
      const data = await getNotionPage(pageId);
      return data;
    } catch (err: any) {
      console.error("Notion page error:", err.message);
      setResponseStatus(event, 500);
      return { error: err.message };
    }
  });
});
