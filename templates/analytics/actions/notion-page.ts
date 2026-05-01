import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getNotionPage } from "../server/lib/notion";
import {
  providerError,
  requireActionCredentials,
} from "./_provider-action-utils";

export default defineAction({
  description:
    "Read a Notion page by page ID using the analytics app's configured Notion integration.",
  schema: z.object({
    pageId: z.string().describe("Notion page ID"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const credentials = await requireActionCredentials(
      ["NOTION_API_KEY"],
      "Notion",
    );
    if (!credentials.ok) return credentials.response;

    try {
      return await getNotionPage(args.pageId);
    } catch (err) {
      return providerError(err);
    }
  },
});
