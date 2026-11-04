import { defineAppConfig } from "@agent-native/core/server";

export default defineAppConfig({
  onboarding: { firstRunCreditsExperiment: "v2" },
  analytics: { authSessionReplay: true },
});
