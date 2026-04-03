import { parseArgs, output, localFetch } from "./helpers.js";
import type { ActionTool } from "@agent-native/core";

export const tool: ActionTool = {
  description: "List upcoming scheduled interviews",
  parameters: {
    type: "object",
    properties: {
      compact: {
        type: "string",
        description: "Return compact output",
        enum: ["true", "false"],
      },
    },
  },
};

export async function run(args: Record<string, string>): Promise<string> {
  const interviews = await localFetch<any[]>("/api/interviews");

  const now = new Date();
  const upcoming = interviews
    .filter((i) => new Date(i.start.date_time) > now)
    .sort(
      (a, b) =>
        new Date(a.start.date_time).getTime() -
        new Date(b.start.date_time).getTime(),
    );

  if (args.compact === "true") {
    return JSON.stringify(
      upcoming.map((i) => ({
        id: i.id,
        start: i.start.date_time,
        end: i.end.date_time,
        interviewers: i.interviewers.map((iv: any) => iv.name),
        location: i.location,
        status: i.status,
      })),
      null,
      2,
    );
  }
  return JSON.stringify(upcoming, null, 2);
}

export default async function main(): Promise<void> {
  const args = parseArgs();
  const result = await run(args);
  console.log(result);
}
