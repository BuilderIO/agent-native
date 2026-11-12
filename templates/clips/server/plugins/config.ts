import { defineAppConfig } from "@agent-native/core/server";

export default defineAppConfig({
  onboarding: {
    firstRunCreditsExperiment: "v2",
    builderSignupExperiment: true,
    builderSignupAutomaticPercent: 100,
    builderSignupExperimentId: "clips_builder_signup_v1",
  },
  analytics: { authSessionReplay: true },
  clips: { hostedStorage: {} },
});
