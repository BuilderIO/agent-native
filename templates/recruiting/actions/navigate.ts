import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { z } from "zod";

export default defineAction({
  description: "Navigate the UI to a specific view, job, or candidate page.",
  schema: z.object({
    view: z
      .enum([
        "dashboard",
        "action-items",
        "jobs",
        "candidates",
        "interviews",
        "settings",
      ])
      .optional()
      .describe("View to navigate to"),
    jobId: z.string().optional().describe("Job ID to open"),
    candidateId: z.string().optional().describe("Candidate ID to open"),
  }),
  http: false,
  run: async (args) => {
    if (!args.view && !args.jobId && !args.candidateId) {
      return "Error: At least --view, --jobId, or --candidateId is required.";
    }
    const nav: Record<string, string> = {};
    if (args.view) nav.view = args.view;
    if (args.jobId) nav.jobId = args.jobId;
    if (args.candidateId) nav.candidateId = args.candidateId;
    await writeAppState("navigate", nav);
    return `Navigating to ${JSON.stringify(nav)}`;
  },
});
