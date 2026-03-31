import { parseArgs, output, localFetch } from "./helpers.js";
import type { ScriptTool } from "@agent-native/core";

export const tool: ScriptTool = {
  description: "Get pipeline view for a job — candidates grouped by stage",
  parameters: {
    type: "object",
    properties: {
      jobId: { type: "string", description: "Job ID (required)" },
      compact: {
        type: "string",
        description: "Return compact output",
        enum: ["true", "false"],
      },
    },
    required: ["jobId"],
  },
};

export async function run(args: Record<string, string>): Promise<string> {
  if (!args.jobId) return "Error: --jobId is required";
  const pipeline = await localFetch<any[]>(`/api/jobs/${args.jobId}/pipeline`);

  if (args.compact === "true") {
    return JSON.stringify(
      pipeline.map((s: any) => ({
        stage: s.stage.name,
        count: s.applications.length,
        candidates: s.applications.map((a: any) => ({
          id: a.candidate_id,
          name: a.candidate_name,
          company: a.candidate_company,
        })),
      })),
      null,
      2,
    );
  }
  return JSON.stringify(pipeline, null, 2);
}

export default async function main(): Promise<void> {
  const args = parseArgs();
  const result = await run(args);
  console.log(result);
}
