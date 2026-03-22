import { defineNitroPlugin, autoMountAuth } from "@agent-native/core";

export default defineNitroPlugin((nitroApp: any) => {
  autoMountAuth(nitroApp.h3App, {
    publicPaths: [
      "/f",
      "/api/forms/public",
      "/api/submit",
    ],
  });
});
