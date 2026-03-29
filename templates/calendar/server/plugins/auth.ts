import { createGoogleAuthPlugin } from "@agent-native/core/server";

export default createGoogleAuthPlugin({
  publicPaths: [
    "/book",
    "/meet",
    "/api/bookings/available-slots",
    "/api/bookings/create",
    "/api/public",
  ],
});
