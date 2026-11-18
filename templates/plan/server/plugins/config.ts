import { defineAppConfig } from "@agent-native/core/server";

export default defineAppConfig({
  onboarding: {
    builderSignupExperimentId: "plan_builder_signup_v1",
    builderSignupHostedHosts: [
      "plan.agent-native.com",
      "beta.plan.agent-native.com",
    ],
    builderSignupAutomaticPercent: 100,
  },
});
