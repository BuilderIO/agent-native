import { defineAppConfig } from "@agent-native/core/server";

export default defineAppConfig({
  onboarding: {
    builderSignupExperimentId: "brain_builder_signup_v1",
    builderSignupHostedHosts: [
      "brain.agent-native.com",
      "beta.brain.agent-native.com",
    ],
    builderSignupAutomaticPercent: 100,
  },
});
