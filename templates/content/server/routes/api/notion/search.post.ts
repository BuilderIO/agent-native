import { defineEventHandler, createError } from "h3";
import {
  getDocumentOwnerEmail,
  getNotionConnectionForOwner,
  notionFetch,
} from "../../../lib/notion.js";
import { readBody } from "@agent-native/core/server";
import type {
  NotionSearchResponse,
  NotionSearchResult,
} from "../../../../shared/api.js";

export default defineEventHandler(
  async (event): Promise<NotionSearchResponse> => {
    const owner = await getDocumentOwnerEmail(event);
    const conn = await getNotionConnectionForOwner(owner);
    if (!conn) {
      throw createError({ statusCode: 400, message: "Notion not connected" });
    }

    const body = await readBody(event);
    const query = (body?.query ?? "").trim();

    const result = await notionFetch<{
      results: Array<{
        id: string;
        object: string;
        icon?: { type: string; emoji?: string } | null;
        url?: string;
        last_edited_time?: string;
        properties?: Record<string, any>;
      }>;
      has_more: boolean;
    }>("/search", conn.accessToken, {
      method: "POST",
      body: JSON.stringify({
        query,
        filter: { value: "page", property: "object" },
        sort: { direction: "descending", timestamp: "last_edited_time" },
        page_size: 20,
      }),
    });

    const results: NotionSearchResult[] = result.results.map((page) => {
      const titleProp = Object.values(page.properties || {}).find(
        (v: any) => v?.type === "title",
      ) as any;
      const title =
        (titleProp?.title || []).map((t: any) => t.plain_text || "").join("") ||
        "Untitled";

      return {
        id: page.id,
        title,
        icon: page.icon?.type === "emoji" ? page.icon.emoji || null : null,
        url: page.url || `https://notion.so/${page.id.replace(/-/g, "")}`,
        lastEditedTime: page.last_edited_time || null,
      };
    });

    return { results, hasMore: result.has_more };
  },
);
