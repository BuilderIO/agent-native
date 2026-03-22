import { defineNitroPlugin, autoMountAuth } from "@agent-native/core";

export default defineNitroPlugin((nitroApp: any) => {
  autoMountAuth(nitroApp.h3App, {
    publicPaths: [
      "/book",
      "/api/bookings/available-slots",
      "/api/bookings/create",
      "/api/public",
    ],
  });
});
