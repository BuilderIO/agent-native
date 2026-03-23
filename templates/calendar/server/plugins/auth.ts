import { createAuthPlugin } from "@agent-native/core/server";

export default createAuthPlugin({
  publicPaths: [
    "/book",
    "/api/bookings/available-slots",
    "/api/bookings/create",
    "/api/public",
  ],
});
