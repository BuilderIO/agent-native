import { defineAppConfig } from "@agent-native/core/server";

export default defineAppConfig({
  app: { id: "analytics" },
  onboarding: {
    builderSignupExperimentId: "analytics_builder_signup_v1",
    builderSignupHostedHosts: [
      "analytics.agent-native.com",
      "beta.analytics.agent-native.com",
    ],
    builderSignupAutomaticPercent: 100,
  },
});
