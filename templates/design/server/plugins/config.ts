import { defineAppConfig } from "@agent-native/core/server";

export default defineAppConfig({
  analytics: { authSessionReplay: true },
  // Serve the bearer-token agent-chat stream route. A host that mounts the
  // editor behind a proxy that buffers responses (Builder's /an/design, through
  // Firebase Hosting) sends chat turns there on an origin that streams; a page
  // that names no streaming URL never calls it.
  runtime: { agentChatStreaming: true },
  agent: {
    questionIntake: {
      enabled: true,
      experimentId: "design_no_questions",
      questionToolNames: ["show-design-questions"],
      treatmentInstructions:
        "For a new design request, never call or ask about `show-design-questions`. Make the first coherent design with sensible defaults instead of opening an intake-question form. Briefly state any important assumptions.",
      trackedEventNames: [
        "design_prompt_submitted",
        "design_ready_viewed",
        "design_exported",
      ],
      clientTrackedEventNames: [
        "design_prompt_submitted",
        "design_ready_viewed",
      ],
    },
  },
});
