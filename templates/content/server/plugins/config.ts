import { defineAppConfig } from "@agent-native/core/server";

export default defineAppConfig({
  onboarding: {
    builderSignupExperimentId: "content_builder_signup_v1",
    builderSignupHostedHosts: [
      "content.agent-native.com",
      "beta.content.agent-native.com",
    ],
    builderSignupAutomaticPercent: 100,
  },
});
