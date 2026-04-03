import { parseArgs, output, fatal } from "./helpers.js";
import { writeAppState } from "@agent-native/core/application-state";
import type { ActionTool } from "@agent-native/core";

export const tool: ActionTool = {
  description: "Navigate the UI to a specific view, job, or candidate page.",
  parameters: {
    type: "object",
    properties: {
      view: {
        type: "string",
        description: "View to navigate to",
        enum: ["dashboard", "jobs", "candidates", "interviews", "settings"],
      },
      jobId: { type: "string", description: "Job ID to open" },
      candidateId: { type: "string", description: "Candidate ID to open" },
    },
  },
};

export async function run(args: Record<string, string>): Promise<string> {
  if (!args.view && !args.jobId && !args.candidateId) {
    return "Error: At least --view, --jobId, or --candidateId is required.";
  }
  const nav: Record<string, string> = {};
  if (args.view) nav.view = args.view;
  if (args.jobId) nav.jobId = args.jobId;
  if (args.candidateId) nav.candidateId = args.candidateId;
  await writeAppState("navigate", nav);
  return `Navigating to ${JSON.stringify(nav)}`;
}

export default async function main(): Promise<void> {
  const args = parseArgs();
  const result = await run(args);
  console.error(result);
  output({ result });
}
