import { defineAppConfig } from "@agent-native/core/server";

import {
  BUILDER_SIGNUP_EXPERIMENT_ID,
  BUILDER_SIGNUP_HOSTED_HOSTS,
} from "../../shared/builder-signup.js";

export default defineAppConfig({
  onboarding: {
    builderSignupExperimentId: BUILDER_SIGNUP_EXPERIMENT_ID,
    firstRunCreditsExperiment: "v2",
    builderSignupHostedHosts: BUILDER_SIGNUP_HOSTED_HOSTS,
    builderSignupAutomaticPercent: 100,
  },
  analytics: { authSessionReplay: true },
});
