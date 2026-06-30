import { defineAction } from "@agent-native/core";
import { z } from "zod";

import {
  getNotionConnectionForOwner,
  notionFetch,
} from "../server/lib/notion.js";
import type {
  NotionSearchResponse,
  NotionSearchResult,
} from "../shared/api.js";
import { getCurrentNotionOwner } from "./_notion-action-utils.js";

export default defineAction({
  description: "Search connected Notion pages visible to the current user.",
  schema: z.object({
    query: z.string().default(""),
  }),
  http: { method: "GET" },
  run: async ({ query }): Promise<NotionSearchResponse> => {
    const owner = getCurrentNotionOwner();
    const conn = await getNotionConnectionForOwner(owner);
    if (!conn) {
      throw new Error("Notion not connected");
    }

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
        query: query.trim(),
        filter: { value: "page", property: "object" },
        sort: { direction: "descending", timestamp: "last_edited_time" },
        page_size: 20,
      }),
    });

    const results: NotionSearchResult[] = result.results.map((page) => {
      const titleProp = Object.values(page.properties || {}).find(
        (value: any) => value?.type === "title",
      ) as any;
      const title =
        (titleProp?.title || [])
          .map((part: any) => part.plain_text || "")
          .join("") || "Untitled";

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
});
