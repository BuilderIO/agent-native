import { defineAction } from "@agent-native/core";
import {
  getCalls,
  getCallTranscript,
  getUsers,
  searchCalls,
} from "../server/lib/gong";

export default defineAction({
  description:
    "Query Gong sales calls, transcripts, and users. Pass --users for user list, --transcript for transcript, --company to search by company.",
  parameters: {
    users: { type: "string", description: "Set to 'true' to list Gong users" },
    transcript: { type: "string", description: "Call ID to get transcript" },
    company: { type: "string", description: "Search calls by company name" },
    days: {
      type: "string",
      description: "Number of days to look back (default 30)",
    },
  },
  http: { method: "GET" },
  run: async (args) => {
    if (args.users === "true") {
      const users = await getUsers();
      return { users, total: users.length };
    } else if (args.transcript) {
      const transcript = await getCallTranscript(args.transcript);
      return { transcript };
    } else if (args.company) {
      const days = args.days ? parseInt(args.days) : 90;
      const calls = await searchCalls(args.company, days);
      return { calls, total: calls.length };
    } else {
      const days = args.days ? parseInt(args.days) : 30;
      const fromDateTime = new Date(
        Date.now() - days * 24 * 60 * 60 * 1000,
      ).toISOString();
      const result = await getCalls({ fromDateTime });
      return { calls: result.calls, total: result.calls.length };
    }
  },
});
