import { defineAppConfig } from "@agent-native/core/server";

export default defineAppConfig({
  onboarding: {
    firstRunCreditsExperiment: "v2",
    builderSignupHostedHosts: [
      "clips.agent-native.com",
      "beta.clips.agent-native.com",
      // Labs serves this public-owned app at /clips on its shared origin.
      "labs.agent-native.com",
      "agent-native-labs-workspace-beta.netlify.app",
    ],
    builderSignupAutomaticPercent: 100,
    builderSignupExperimentId: "clips_builder_signup_v1",
  },
  analytics: { authSessionReplay: true },
  clips: { hostedStorage: {} },
});
