import { defineAppConfig } from "@agent-native/core/server";

import {
  BUILDER_SIGNUP_EXPERIMENT_ID,
  BUILDER_SIGNUP_HOSTED_HOSTS,
} from "../../shared/builder-signup.js";

export default defineAppConfig({
  onboarding: {
    builderSignupExperimentId: BUILDER_SIGNUP_EXPERIMENT_ID,
    firstRunCreditsExperiment: "v2",
    builderSignupHostedHosts: BUILDER_SIGNUP_HOSTED_HOSTS,
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
