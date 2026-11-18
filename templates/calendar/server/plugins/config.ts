import { defineAppConfig } from "@agent-native/core/server";

export default defineAppConfig({
  onboarding: {
    builderSignupExperimentId: "calendar_builder_signup_v1",
    builderSignupHostedHosts: [
      "calendar.agent-native.com",
      "beta.calendar.agent-native.com",
    ],
    builderSignupAutomaticPercent: 100,
  },
});
