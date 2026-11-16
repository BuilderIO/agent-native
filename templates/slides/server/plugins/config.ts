import { defineAppConfig } from "@agent-native/core/server";

export default defineAppConfig({
  onboarding: {
    firstRunCreditsExperiment: "v2",
    builderSignupExperiment: true,
    builderSignupExperimentId: "slides_builder_signup_v1",
  },
  analytics: { authSessionReplay: true },
});
