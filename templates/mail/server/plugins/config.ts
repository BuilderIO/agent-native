import { defineAppConfig } from "@agent-native/core/server";

export default defineAppConfig({
  onboarding: {
    builderSignupExperimentId: "mail_builder_signup_v1",
    builderSignupHostedHosts: [
      "mail.agent-native.com",
      "beta.mail.agent-native.com",
    ],
    builderSignupAutomaticPercent: 100,
  },
});
