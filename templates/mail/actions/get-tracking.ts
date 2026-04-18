import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { resolveOwnerEmail } from "./helpers.js";
import { getTrackingStats } from "../server/lib/email-tracking.js";

export default defineAction({
  description:
    "Get open / link-click tracking stats for a sent email (by message ID).",
  schema: z.object({
    id: z.string().describe("Message ID (Gmail message ID) of a sent email"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const owner = await resolveOwnerEmail();
    const stats = await getTrackingStats(args.id, owner);
    if (!stats) {
      return JSON.stringify(
        { opens: 0, linkClicks: [], totalClicks: 0, tracked: false },
        null,
        2,
      );
    }
    return JSON.stringify({ ...stats, tracked: true }, null, 2);
  },
});
