import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  DEFAULT_GONG_CALL_LIMIT,
  limitGongCalls,
  normalizeGongCallLimit,
} from "../server/lib/gong-limits";
import {
  getCalls,
  getCallTranscript,
  getUsers,
  searchCalls,
} from "../server/lib/gong";

function callLimitGuidance(limit: number, truncated: boolean): string {
  return truncated
    ? `Returned the ${limit} most recent matching calls. Answer from this bounded sample now; ask the user before loading more calls.`
    : `Returned ${limit} or fewer matching calls. Answer from these calls now; do not expand the search unless the user explicitly asks.`;
}

export default defineAction({
  description:
    "Query Gong sales calls, transcripts, and users. Pass --users for user list, --transcript for one transcript, --company to search by company. Default call searches return only the 8 most recent matches; answer from that bounded batch unless the user asks for more.",
  schema: z.object({
    users: z.coerce
      .boolean()
      .optional()
      .describe("Set to true to list Gong users"),
    transcript: z.string().optional().describe("Call ID to get transcript"),
    company: z.string().optional().describe("Search calls by company name"),
    days: z.coerce
      .number()
      .optional()
      .describe("Number of days to look back (default 30)"),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(25)
      .optional()
      .describe(
        "Maximum number of calls to return for call searches (default 8, max 25). Use 5-8 for ordinary analysis.",
      ),
  }),
  http: { method: "GET" },
  run: async (args) => {
    if (args.users) {
      const users = await getUsers();
      return { users, total: users.length };
    } else if (args.transcript) {
      const transcript = await getCallTranscript(args.transcript);
      return { transcript };
    } else if (args.company) {
      const days = args.days ?? 90;
      const limit = normalizeGongCallLimit(
        args.limit ?? DEFAULT_GONG_CALL_LIMIT,
      );
      const result = await searchCalls(args.company, days, limit);
      return {
        ...result,
        total: result.calls.length,
        guidance: callLimitGuidance(result.limit, result.truncated),
      };
    } else {
      const days = args.days ?? 30;
      const limit = normalizeGongCallLimit(
        args.limit ?? DEFAULT_GONG_CALL_LIMIT,
      );
      const fromDateTime = new Date(
        Date.now() - days * 24 * 60 * 60 * 1000,
      ).toISOString();
      const result = await getCalls({ fromDateTime });
      const limited = limitGongCalls(result.calls, limit);
      return {
        ...limited,
        total: limited.calls.length,
        guidance: callLimitGuidance(limited.limit, limited.truncated),
      };
    }
  },
});
