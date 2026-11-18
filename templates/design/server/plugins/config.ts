import { defineAppConfig } from "@agent-native/core/server";

export default defineAppConfig({
  onboarding: {
    firstRunCreditsExperiment: "v2",
    builderSignupHostedHosts: [
      "design.agent-native.com",
      "beta.design.agent-native.com",
      // Labs serves this public-owned app at /design on its shared origin.
      "labs.agent-native.com",
      "agent-native-labs-workspace-beta.netlify.app",
    ],
    builderSignupAutomaticPercent: 100,
  },
  analytics: { authSessionReplay: true },
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
