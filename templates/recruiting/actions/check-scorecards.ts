import { parseArgs, localFetch } from "./helpers.js";
import type { ActionTool } from "@agent-native/core";

export const tool: ActionTool = {
  description:
    "Check scorecard status — find overdue scorecards, pending feedback, and recently submitted scorecards. Use this to see what feedback is missing and who needs to submit their scorecards.",
  parameters: {
    type: "object",
    properties: {
      overdueHours: {
        type: "string",
        description:
          "Hours after interview to consider a scorecard overdue (default: 24)",
      },
      section: {
        type: "string",
        description:
          "Which section to return: overdue, pending, recent, or all (default: all)",
        enum: ["overdue", "pending", "recent", "all"],
      },
    },
  },
};

export async function run(args: Record<string, string>): Promise<string> {
  const qs = new URLSearchParams();
  if (args.overdueHours) qs.set("overdue_hours", args.overdueHours);

  const data = await localFetch<any>(`/api/action-items?${qs}`);

  if (args.section && args.section !== "all") {
    const sectionMap: Record<string, string> = {
      overdue: "overdueScorecards",
      pending: "pendingScorecards",
      recent: "recentScorecards",
    };
    const key = sectionMap[args.section];
    return JSON.stringify(
      {
        [args.section]: data[key],
        count: data[key]?.length ?? 0,
      },
      null,
      2,
    );
  }

  return JSON.stringify(
    {
      overdueScorecards: data.overdueScorecards,
      pendingScorecards: data.pendingScorecards,
      recentScorecards: data.recentScorecards,
      summary: data.summary,
    },
    null,
    2,
  );
}

export default async function main(): Promise<void> {
  const args = parseArgs();
  const result = await run(args);
  console.log(result);
}
