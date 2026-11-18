import { defineAppConfig } from "@agent-native/core/server";

export default defineAppConfig({
  onboarding: {
    firstRunCreditsExperiment: "v2",
    builderSignupHostedHosts: [
      "slides.agent-native.com",
      "beta.slides.agent-native.com",
    ],
    builderSignupAutomaticPercent: 100,
    builderSignupExperimentId: "slides_builder_signup_v1",
  },
  analytics: { authSessionReplay: true },
});
