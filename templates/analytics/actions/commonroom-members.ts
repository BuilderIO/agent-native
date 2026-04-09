import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  getMemberByEmail,
  getMembers,
  getSegments,
} from "../server/lib/commonroom";

export default defineAction({
  description:
    "Query Common Room community members by email, query, or list segments.",
  schema: z.object({
    email: z.string().optional().describe("Look up member by email"),
    query: z.string().optional().describe("Search query"),
    segments: z.coerce
      .boolean()
      .optional()
      .describe("Set to true to list segments"),
    limit: z.coerce.number().optional().describe("Max results (default 25)"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    if (args.segments) {
      const segments = await getSegments();
      return { segments };
    } else if (args.email) {
      const member = await getMemberByEmail(args.email);
      return { member };
    } else {
      const result = await getMembers({
        query: args.query,
        limit: args.limit ?? 25,
      });
      return { members: result.items, total: result.items?.length ?? 0 };
    }
  },
});
