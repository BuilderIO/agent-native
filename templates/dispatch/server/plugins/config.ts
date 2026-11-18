import { defineAppConfig } from "@agent-native/core/server";

export default defineAppConfig({
  app: { homePath: "/chat" },
  onboarding: {
    builderSignupExperimentId: "dispatch_builder_signup_v1",
    builderSignupHostedHosts: [
      "dispatch.agent-native.com",
      "beta.dispatch.agent-native.com",
    ],
    builderSignupAutomaticPercent: 100,
  },
});
