import { parseArgs, output, localFetch } from "./helpers.js";
import type { ActionTool } from "@agent-native/core";

export const tool: ActionTool = {
  description: "List all jobs from Greenhouse with optional status filter",
  parameters: {
    type: "object",
    properties: {
      status: {
        type: "string",
        description: "Filter by status",
        enum: ["open", "closed", "draft"],
      },
      compact: {
        type: "string",
        description: "Return compact output with fewer fields",
        enum: ["true", "false"],
      },
    },
  },
};

export async function run(args: Record<string, string>): Promise<string> {
  const params = new URLSearchParams();
  if (args.status) params.set("status", args.status);
  const jobs = await localFetch<any[]>(`/api/jobs?${params}`);

  if (args.compact === "true") {
    return JSON.stringify(
      jobs.map((j) => ({
        id: j.id,
        name: j.name,
        status: j.status,
        department: j.departments?.[0]?.name,
        openings: j.openings?.length ?? 0,
      })),
      null,
      2,
    );
  }
  return JSON.stringify(jobs, null, 2);
}

export default async function main(): Promise<void> {
  const args = parseArgs();
  const result = await run(args);
  console.log(result);
}
