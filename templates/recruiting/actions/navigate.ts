import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";

export default defineAction({
  description: "Navigate the UI to a specific view, job, or candidate page.",
  parameters: {
    view: {
      type: "string",
      description: "View to navigate to",
      enum: [
        "dashboard",
        "action-items",
        "jobs",
        "candidates",
        "interviews",
        "settings",
      ],
    },
    jobId: { type: "string", description: "Job ID to open" },
    candidateId: { type: "string", description: "Candidate ID to open" },
  },
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
