import { defineAppConfig } from "@agent-native/core/server";

import {
  BUILDER_SIGNUP_EXPERIMENT_ID,
  BUILDER_SIGNUP_HOSTED_HOSTS,
} from "../../shared/builder-signup.js";

export default defineAppConfig({
  onboarding: {
    firstRunCreditsExperiment: "v2",
    builderSignupHostedHosts: BUILDER_SIGNUP_HOSTED_HOSTS,
    builderSignupAutomaticPercent: 100,
    builderSignupExperimentId: BUILDER_SIGNUP_EXPERIMENT_ID,
  },
  analytics: { authSessionReplay: true },
});
