import { defineAppConfig } from "@agent-native/core/server";

export default defineAppConfig({
  app: { slug: "slides-2" },
  analytics: { authSessionReplay: true },
});
