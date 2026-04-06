import { parseArgs, localFetch } from "./helpers.js";
import type { ActionTool } from "@agent-native/core";

export const tool: ActionTool = {
  description:
    "Check pipeline health — find candidates stuck in a stage with no activity, and get an overall summary of what needs attention in the recruiting pipeline.",
  parameters: {
    type: "object",
    properties: {
      stuckDays: {
        type: "string",
        description:
          "Number of days of inactivity before a candidate is considered stuck (default: 5)",
      },
    },
  },
};

export async function run(args: Record<string, string>): Promise<string> {
  const qs = new URLSearchParams();
  if (args.stuckDays) qs.set("stuck_days", args.stuckDays);

  const data = await localFetch<any>(`/api/action-items?${qs}`);

  return JSON.stringify(
    {
      stuckCandidates: data.stuckCandidates,
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
