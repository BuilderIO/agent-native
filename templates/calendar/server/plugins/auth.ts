import { createGoogleAuthPlugin } from "@agent-native/core/server";

export default createGoogleAuthPlugin({
  publicPaths: [
    "/book",
    "/api/bookings/available-slots",
    "/api/bookings/create",
    "/api/public",
  ],
});
