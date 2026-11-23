import { defineAppConfig } from "@agent-native/core/server";

import {
  BUILDER_SIGNUP_EXPERIMENT_ID,
  BUILDER_SIGNUP_HOSTED_HOSTS,
} from "../../shared/builder-signup.js";

export default defineAppConfig({
  app: { homePath: "/chat" },
  agent: {
    detailRoutes: [
      "/admin/transactional-email/:appId/:id",
      "/transactional-email/:appId/:id",
      "/admin/automations/:id",
      "/chat/:threadId",
      "/apps/:appId/*",
      "/extensions/:id",
      "/extensions/:id/:slug",
      "/tools/:id",
    ],
  },
  onboarding: {
    builderSignupExperimentId: BUILDER_SIGNUP_EXPERIMENT_ID,
    builderSignupHostedHosts: BUILDER_SIGNUP_HOSTED_HOSTS,
    builderSignupAutomaticPercent: 100,
  },
});
