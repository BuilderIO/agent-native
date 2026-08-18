import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { searchProviderLogos } from "../server/lib/media-search-providers.js";

export default defineAction({
  description: "Search for company logos by name or domain.",
  schema: z.object({
    q: z.string().optional().describe("Company name or domain to search"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args) => {
    const q = (args.q || "").trim();
    if (!q) {
      throw new Error("Missing ?q= parameter");
    }
    return searchProviderLogos(q);
  },
});
