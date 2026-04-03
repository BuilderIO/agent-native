import { parseArgs, output, localFetch } from "./helpers.js";
import type { ActionTool } from "@agent-native/core";

export const tool: ActionTool = {
  description:
    "Get details about a specific job including pipeline stage summary",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string", description: "Job ID (required)" },
    },
    required: ["id"],
  },
};

export async function run(args: Record<string, string>): Promise<string> {
  if (!args.id) return "Error: --id is required";
  const [job, pipeline] = await Promise.all([
    localFetch<any>(`/api/jobs/${args.id}`),
    localFetch<any[]>(`/api/jobs/${args.id}/pipeline`),
  ]);

  const pipelineSummary = pipeline.map((s: any) => ({
    stage: s.stage.name,
    count: s.applications.length,
  }));

  return JSON.stringify({ ...job, pipeline_summary: pipelineSummary }, null, 2);
}

export default async function main(): Promise<void> {
  const args = parseArgs();
  const result = await run(args);
  console.log(result);
}
