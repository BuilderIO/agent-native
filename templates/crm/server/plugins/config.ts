import { defineAppConfig } from "@agent-native/core/server";

export default defineAppConfig({
  onboarding: {
    builderSignupExperimentId: "crm_builder_signup_v1",
    builderSignupHostedHosts: [
      "crm.agent-native.com",
      "beta.crm.agent-native.com",
    ],
    builderSignupAutomaticPercent: 100,
  },
});
