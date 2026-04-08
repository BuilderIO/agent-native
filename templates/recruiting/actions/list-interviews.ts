import { defineAction } from "@agent-native/core";
import * as gh from "../server/lib/greenhouse-api.js";
import { withOrgContext } from "../server/lib/greenhouse-api.js";

async function listInterviews(args: Record<string, string>) {
  const defaultAfter = new Date(
    Date.now() - 365 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const interviews = await gh.listScheduledInterviews({
    created_after: defaultAfter,
  });

  const now = new Date();
  const upcoming = interviews
    .filter((i) => new Date(i.start.date_time) > now)
    .sort(
      (a, b) =>
        new Date(a.start.date_time).getTime() -
        new Date(b.start.date_time).getTime(),
    );

  if (args.compact === "true") {
    return upcoming.map((i) => ({
      id: i.id,
      start: i.start.date_time,
      end: i.end.date_time,
      interviewers: i.interviewers.map((iv: any) => iv.name),
      location: i.location,
      status: i.status,
    }));
  }
  return upcoming;
}

export default defineAction({
  description: "List upcoming scheduled interviews",
  parameters: {
    compact: {
      type: "string",
      description: "Return compact output",
      enum: ["true", "false"],
    },
  },
  http: { method: "GET" },
  run: async (args) => {
    const orgId = process.env.AGENT_ORG_ID;
    if (orgId) {
      return withOrgContext(orgId, () => listInterviews(args));
    }
    return listInterviews(args);
  },
});
