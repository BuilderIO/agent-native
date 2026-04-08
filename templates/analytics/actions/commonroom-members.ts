import { defineAction } from "@agent-native/core";
import {
  getMemberByEmail,
  getMembers,
  getSegments,
} from "../server/lib/commonroom";

export default defineAction({
  description:
    "Query Common Room community members by email, query, or list segments.",
  parameters: {
    email: { type: "string", description: "Look up member by email" },
    query: { type: "string", description: "Search query" },
    segments: { type: "string", description: "Set to 'true' to list segments" },
    limit: { type: "string", description: "Max results (default 25)" },
  },
  http: { method: "GET" },
  run: async (args) => {
    if (args.segments === "true") {
      const segments = await getSegments();
      return { segments };
    } else if (args.email) {
      const member = await getMemberByEmail(args.email);
      return { member };
    } else {
      const result = await getMembers({
        query: args.query,
        limit: args.limit ? parseInt(args.limit) : 25,
      });
      return { members: result.items, total: result.items?.length ?? 0 };
    }
  },
});
