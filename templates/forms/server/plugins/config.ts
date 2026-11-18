import { defineAppConfig } from "@agent-native/core/server";

export default defineAppConfig({
  onboarding: {
    builderSignupExperimentId: "forms_builder_signup_v1",
    builderSignupHostedHosts: [
      "forms.agent-native.com",
      "beta.forms.agent-native.com",
    ],
    builderSignupAutomaticPercent: 100,
  },
});
