import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import {
  getNotionConnectionForOwner,
  notionFetch,
} from "../server/lib/notion.js";
import type { NotionDatabaseSourcesResponse } from "../shared/api.js";

function plainText(value: unknown) {
  return Array.isArray(value)
    ? value
        .map((part) =>
          typeof part === "object" && part && "plain_text" in part
            ? String((part as { plain_text?: unknown }).plain_text ?? "")
            : "",
        )
        .join("")
    : "";
}

export default defineAction({
  description:
    "List Notion data sources visible to the current user's connected Notion workspace so one can be attached read-only to a Content database.",
  schema: z.object({
    query: z.string().trim().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().trim().min(1).optional(),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args): Promise<NotionDatabaseSourcesResponse> => {
    const userEmail = getRequestUserEmail();
    if (!userEmail)
      throw new Error("Notion database access requires a signed-in user.");
    const connection = await getNotionConnectionForOwner(userEmail);
    if (!connection) {
      return {
        connected: false,
        workspaceName: null,
        sources: [],
        hasMore: false,
        nextCursor: null,
      };
    }
    const response = await notionFetch<{
      results?: Array<{
        object?: string;
        id: string;
        url?: string;
        title?: unknown;
        name?: string;
      }>;
      has_more?: boolean;
      next_cursor?: string | null;
    }>("/search", connection.accessToken, {
      method: "POST",
      body: JSON.stringify({
        page_size: args.limit,
        filter: { property: "object", value: "data_source" },
        ...(args.query ? { query: args.query } : {}),
        ...(args.cursor ? { start_cursor: args.cursor } : {}),
      }),
    });
    return {
      connected: true,
      workspaceName: connection.workspaceName,
      sources: (response.results ?? [])
        .filter((result) => result.object === "data_source")
        .map((result) => ({
          id: result.id,
          name: plainText(result.title) || result.name || "Untitled database",
          url: result.url ?? null,
        })),
      hasMore: response.has_more === true,
      nextCursor: response.next_cursor ?? null,
    };
  },
});
