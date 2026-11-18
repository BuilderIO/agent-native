import { defineAppConfig } from "@agent-native/core/server";

export default defineAppConfig({
  onboarding: {
    builderSignupExperimentId: "factory_builder_signup_v1",
    builderSignupHostedHosts: [
      "factory.agent-native.com",
      "beta.factory.agent-native.com",
    ],
    builderSignupAutomaticPercent: 100,
  },
});
