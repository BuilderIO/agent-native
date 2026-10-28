import { defineAppConfig } from "@agent-native/core/server";

export default defineAppConfig({
  analytics: { authSessionReplay: true },
});
