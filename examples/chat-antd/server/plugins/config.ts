import { defineAppConfig } from "@agent-native/core/server";

// This example keeps its chat app at the root (app/routes/_index.tsx) instead of
// the /home marketing/app split the first-party templates use. Without this the
// framework default resolves the authenticated home to /home, which has no route.
export default defineAppConfig({
  app: {
  },
});
