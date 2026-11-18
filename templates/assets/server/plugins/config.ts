import { defineAppConfig } from "@agent-native/core/server";

export default defineAppConfig({
  onboarding: {
    builderSignupExperimentId: "assets_builder_signup_v1",
    builderSignupHostedHosts: [
      "assets.agent-native.com",
      "beta.assets.agent-native.com",
    ],
    builderSignupAutomaticPercent: 100,
  },
});
